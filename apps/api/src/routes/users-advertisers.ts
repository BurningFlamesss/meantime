import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PAYOUT_THRESHOLD_USD,
  SOCIAL_TASK_REWARD_USD,
  campaignInputSchema,
  clickEventSchema,
  payoutRequestSchema,
  taskSubmissionSchema,
  verifyLeaseToken,
  type CampaignStats,
  type TaskSubmission,
  type TransparencyLogEntry,
  type UserBalance,
} from "@meantime/shared";
import {
  campaigns,
  campaignVariants,
  clickEvents,
  impressions,
  payoutDestinations,
  payoutRequests,
  referrals,
  socialTasks,
  users,
  advertisers,
} from "@meantime/shared/db";
import type { AppContext } from "../context.js";
import { requireAdvertiser, requireUser } from "../context.js";
import { ACCOUNTS, balanceOf, postTransfer } from "../ledger.js";
import { computeTrustScore, verdictFor, logFraud } from "../fraud/trust.js";
import { moderateCampaign, moderateTask } from "../moderation/laya.js";
import { resolveGeo, clusterForIp } from "../geo.js";
import { referralCodeFor } from "../referrals.js";
import { rateLimit } from "../rate-limit.js";

function s3(ctx: AppContext): S3Client {
  return new S3Client({
    endpoint: ctx.env.S3_ENDPOINT,
    region: ctx.env.S3_REGION,
    credentials: { accessKeyId: ctx.env.S3_ACCESS_KEY, secretAccessKey: ctx.env.S3_SECRET_KEY },
    forcePathStyle: true,
    // Newer SDKs add a CRC32 of the empty presign payload to the URL. A real
    // upload then carries different bytes and storage rejects the checksum,
    // so presigned PUTs must not pin a request checksum.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const PROOF_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * A presigned key only proves the client asked for a URL. Confirm the object
 * was actually uploaded, is a plausible screenshot, and is bounded in size
 * before a proof can enter the review queue. Storage being unreachable fails
 * closed: an unverifiable proof must not look acceptable to a reviewer.
 */
async function verifyProofObject(
  ctx: AppContext,
  key: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    const head = await s3(ctx).send(
      new HeadObjectCommand({ Bucket: ctx.env.S3_BUCKET, Key: key }),
    );
    const size = head.ContentLength ?? 0;
    const contentType = (head.ContentType ?? "").toLowerCase();
    if (size <= 0) return { ok: false, status: 400, error: "proof_empty" };
    if (size > MAX_PROOF_BYTES) return { ok: false, status: 400, error: "proof_too_large" };
    if (!PROOF_CONTENT_TYPES.has(contentType)) {
      return { ok: false, status: 400, error: "proof_not_an_image" };
    }
    return { ok: true };
  } catch (error) {
    const meta = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
    if (meta?.httpStatusCode === 404 || (error as Error).name === "NotFound") {
      return { ok: false, status: 400, error: "proof_missing" };
    }
    return { ok: false, status: 503, error: "proof_storage_unavailable" };
  }
}

export async function userRoutes(app: FastifyInstance, ctx: AppContext) {
  /* ------------------------------ balance ------------------------------- */
  app.get("/me/balance", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const [available, pending, platformRevenue] = await Promise.all([
      balanceOf(ctx.db, ACCOUNTS.user(auth.userId)),
      balanceOf(ctx.db, ACCOUNTS.userPending(auth.userId)),
      balanceOf(ctx.db, ACCOUNTS.platformRevenue),
    ]);
    void platformRevenue;
    const balance: UserBalance = {
      availableMicro: Number(available),
      pendingMicro: Number(pending),
      lifetimeMicro: Number(available + pending),
      thresholdMicro: PAYOUT_THRESHOLD_USD,
    };
    return balance;
  });

  /* -------------------------- transparency log -------------------------- */
  app.get("/me/impressions", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const rows = await ctx.db
      .select({
        impressionId: impressions.id,
        submittedAt: impressions.submittedAt,
        platform: impressions.platform,
        cumulativeVisibleMs: impressions.cumulativeVisibleMs,
        earned: impressions.earned,
        earnedMicro: impressions.earnedMicro,
        headline: campaigns.headline,
      })
      .from(impressions)
      .leftJoin(campaigns, eq(impressions.campaignId, campaigns.id))
      .where(eq(impressions.userId, auth.userId))
      .orderBy(desc(impressions.createdAt))
      .limit(100);
    const log: TransparencyLogEntry[] = rows.map((r) => ({
      impressionId: r.impressionId,
      viewedAt: r.submittedAt.getTime(),
      platform: r.platform,
      cumulativeVisibleMs: r.cumulativeVisibleMs,
      eligible: r.earned,
      earnedMicro: Number(r.earnedMicro),
      campaignHeadline: r.headline ?? "",
    }));
    return log;
  });

  /* ------------------------------ social tasks -------------------------- */
  app.post("/tasks/presign", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const { contentType } = req.body as { contentType?: string };
    const key = `task-proofs/${auth.userId}/${crypto.randomUUID()}`;
    const url = await getSignedUrl(
      s3(ctx),
      new PutObjectCommand({
        Bucket: ctx.env.S3_BUCKET,
        Key: key,
        ContentType: contentType ?? "image/png",
      }),
      { expiresIn: 900 },
    );
    return { uploadUrl: url, key };
  });

  app.post("/tasks/submit", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    if (!rateLimit(req, reply, "task_submit", 20, 3_600_000, auth.userId)) return;
    const body = taskSubmissionSchema.parse(req.body);
    const { screenshotKey } = body;
    // A presigned key is scoped to the uploader; reject keys from other users
    // so one account cannot claim another account's proof.
    if (!screenshotKey.startsWith(`task-proofs/${auth.userId}/`)) {
      return reply.code(400).send({ error: "invalid_screenshot_key" });
    }
    const proof = await verifyProofObject(ctx, screenshotKey);
    if (!proof.ok) return reply.code(proof.status).send({ error: proof.error });

    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    // Laya auto-moderation of the task proof image + claimed URL.
    const moderation = await moderateTask({
      postUrl: body.postUrl,
      taskType: body.taskType,
      screenshotKey,
      accountAgeDays: user ? (Date.now() - user.createdAt.getTime()) / 86_400_000 : 0,
    });

    const status =
      moderation.decision === "auto_approved"
        ? "approved"
        : moderation.decision === "auto_rejected"
          ? "rejected"
          : "pending";

    // Insert and (if approved) pay in one transaction. The unique (user, post)
    // index makes a duplicate submission a no-op instead of a second reward.
    const task = await ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(socialTasks)
        .values({
          userId: auth.userId!,
          taskType: body.taskType,
          postUrl: body.postUrl,
          screenshotKey,
          rewardMicro: BigInt(SOCIAL_TASK_REWARD_USD),
          status,
          moderationDecision: moderation.decision,
          moderationScore: moderation.score,
          moderationReasons: moderation.reasons,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) return null;

      if (status === "approved") {
        await postTransfer(tx, {
          entryType: "social_task_reward",
          from: ACCOUNTS.platformPromoLiability,
          to: ACCOUNTS.user(auth.userId!),
          amountMicro: BigInt(SOCIAL_TASK_REWARD_USD),
          referenceType: "social_task",
          referenceId: created.id,
          memo: `Social task (${body.taskType}) auto-approved by Laya`,
        });
      }
      return created;
    });

    if (!task) return reply.code(409).send({ error: "already_submitted" });
    return { taskId: task.id, status: task.status, moderation };
  });

  app.get("/tasks/mine", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const rows = await ctx.db
      .select()
      .from(socialTasks)
      .where(eq(socialTasks.userId, auth.userId))
      .orderBy(desc(socialTasks.createdAt))
      .limit(50);
    return rows;
  });

  /* ------------------------------- payouts ------------------------------ */
  app.post("/payouts/request", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    if (!rateLimit(req, reply, "payout_request", 5, 3_600_000, auth.userId)) return;
    const userId = auth.userId;
    const body = payoutRequestSchema.parse(req.body);
    const amountMicro = BigInt(body.amountMicro);
    const addressNormalized = body.address.trim().toLowerCase();

    const trust = await computeTrustScore(ctx.db, userId);
    const verdict = verdictFor(trust.total);
    const status =
      verdict === "auto_approve" ? "approved" : verdict === "manual_review" ? "auditing" : "frozen";

    // The user row is the per-user mutex. Balance, open-request and destination
    // checks all run under it, so two concurrent withdrawals can never both
    // pass the balance check and overdraw the account.
    const outcome = await ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update")
        .limit(1);
      if (!user) return { error: "user_missing" } as const;
      if (user.isFrozen) return { error: "account_frozen" } as const;

      const open = await tx
        .select({ id: payoutRequests.id })
        .from(payoutRequests)
        .where(and(eq(payoutRequests.userId, userId), sql`${payoutRequests.status} in ('requested','auditing')`))
        .limit(1);
      if (open.length > 0) return { error: "payout_in_progress" } as const;

      const available = await balanceOf(tx, ACCOUNTS.user(userId));
      if (available < BigInt(PAYOUT_THRESHOLD_USD)) {
        return { error: "below_threshold" } as const;
      }
      if (amountMicro > available) return { error: "insufficient_balance" } as const;

      // Layer 5: one payout address = one account. The unique index is the
      // final arbiter; this check gives a clean 409 in the common case.
      const conflict = await tx
        .select({ userId: payoutDestinations.userId })
        .from(payoutDestinations)
        .where(
          and(
            eq(payoutDestinations.method, body.method),
            eq(payoutDestinations.addressNormalized, addressNormalized),
            sql`${payoutDestinations.userId} <> ${userId}`,
          ),
        )
        .limit(1);
      if (conflict.length > 0) return { error: "address_in_use" } as const;

      const [dest] = await tx
        .insert(payoutDestinations)
        .values({ userId, method: body.method, addressNormalized, addressDisplay: body.address })
        .onConflictDoNothing()
        .returning();
      const destinationId =
        dest?.id ??
        (
          await tx
            .select()
            .from(payoutDestinations)
            .where(
              and(
                eq(payoutDestinations.userId, userId),
                eq(payoutDestinations.method, body.method),
                eq(payoutDestinations.addressNormalized, addressNormalized),
              ),
            )
            .limit(1)
        )[0]?.id;
      if (!destinationId) return { error: "address_in_use" } as const;

      const [request] = await tx
        .insert(payoutRequests)
        .values({
          userId,
          destinationId,
          amountMicro,
          status,
          trustScoreAtRequest: trust.total,
          trustBreakdown: trust as unknown as Record<string, unknown>,
        })
        .returning();
      if (!request) return { error: "request_failed" } as const;

      if (status !== "frozen") {
        await postTransfer(tx, {
          entryType: "payout_debit",
          from: ACCOUNTS.user(userId),
          to: ACCOUNTS.platformFloat,
          amountMicro,
          referenceType: "payout",
          referenceId: request.id,
        });
        // Unlock the pending welcome bonus once the user has crossed the threshold.
        const pending = await balanceOf(tx, ACCOUNTS.userPending(userId));
        if (pending > 0n) {
          await postTransfer(tx, {
            entryType: "welcome_bonus",
            from: ACCOUNTS.userPending(userId),
            to: ACCOUNTS.user(userId),
            amountMicro: pending,
            referenceType: "payout",
            referenceId: request.id,
            memo: "Welcome bonus unlocked at withdrawal threshold",
          });
        }
      }

      return { request } as const;
    });

    if ("error" in outcome) {
      if (outcome.error === "account_frozen") return reply.code(403).send({ error: outcome.error });
      if (outcome.error === "payout_in_progress" || outcome.error === "address_in_use") {
        if (outcome.error === "address_in_use") {
          await logFraud(ctx.db, {
            userId,
            severity: "critical",
            rule: "sybil_payout_address",
            detail: { addressNormalized },
          });
        }
        return reply.code(409).send({ error: outcome.error });
      }
      if (outcome.error === "below_threshold") {
        return reply.code(400).send({ error: outcome.error, thresholdMicro: PAYOUT_THRESHOLD_USD });
      }
      if (outcome.error === "insufficient_balance") {
        return reply.code(400).send({ error: outcome.error });
      }
      return reply.code(400).send({ error: outcome.error });
    }

    const request = outcome.request;
    if (request.status === "frozen") {
      await logFraud(ctx.db, {
        userId,
        severity: "critical",
        rule: "payout_frozen_low_trust",
        detail: trust as unknown as Record<string, unknown>,
      });
    }

    return { payoutId: request.id, status: request.status, trustScore: trust.total };
  });

  /* ------------------------------ referrals ----------------------------- */
  app.get("/me/referrals", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const code = referralCodeFor(auth.userId);
    const rows = await ctx.db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerId, auth.userId))
      .orderBy(desc(referrals.createdAt))
      .limit(100);
    const stats = {
      code,
      link: `${ctx.env.WEB_ORIGIN}/r/${code}`,
      total: rows.length,
      pending: rows.filter((r) => r.status === "pending").length,
      paid: rows.filter((r) => r.status === "paid").length,
      earnedMicro: rows
        .filter((r) => r.status === "paid")
        .reduce((a, r) => a + Number(r.bonusMicro), 0),
    };
    return stats;
  });
}

export async function advertiserRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/advertiser/campaigns/:id/variants", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const { id } = req.params as { id: string };
    const [campaign] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (!campaign || campaign.advertiserId !== auth.advertiserId) {
      return reply.code(404).send({ error: "not_found" });
    }

    const body = campaignInputSchema.pick({ headline: true, bodyText: true, ctaText: true }).parse(req.body);
    const existing = await ctx.db
      .select({ label: campaignVariants.label })
      .from(campaignVariants)
      .where(eq(campaignVariants.campaignId, id));
    if (existing.length >= 2) {
      return reply.code(400).send({ error: "max_variants_reached", max: 3 });
    }
    const label = existing.length === 0 ? "B" : "C";

    // Each variant goes through Laya independently.
    const moderation = await moderateCampaign({
      headline: body.headline,
      bodyText: body.bodyText,
      ctaText: body.ctaText,
      targetUrl: campaign.targetUrl,
      advertiserAgeDays: 999, // reputation already established by base campaign
      advertiserRejectedCount: 0,
      advertiserApprovedCount: 999,
    });

    const [variant] = await ctx.db
      .insert(campaignVariants)
      .values({
        campaignId: id,
        label,
        headline: body.headline,
        bodyText: body.bodyText,
        ctaText: body.ctaText,
        moderationDecision: moderation.decision,
        moderationScore: moderation.score,
        moderationReasons: moderation.reasons,
      })
      .returning();
    return { variant, moderation };
  });

  app.get("/advertiser/campaigns/:id/variants", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const { id } = req.params as { id: string };
    const [campaign] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (!campaign || campaign.advertiserId !== auth.advertiserId) {
      return reply.code(404).send({ error: "not_found" });
    }
    const rows = await ctx.db
      .select()
      .from(campaignVariants)
      .where(eq(campaignVariants.campaignId, id));

    // Per-variant performance.
    const withStats = await Promise.all(
      rows.map(async (v) => {
        const [agg] = await ctx.db
          .select({
            views: sql<number>`count(*)`,
            verifiedViews: sql<number>`count(*) filter (where ${impressions.earned})`,
            avgRetentionMs: sql<number>`coalesce(avg(${impressions.cumulativeVisibleMs}), 0)`,
          })
          .from(impressions)
          .where(eq(impressions.variantId, v.id));
        const views = Number(agg?.views ?? 0);
        return {
          ...v,
          views,
          verifiedViews: Number(agg?.verifiedViews ?? 0),
          completionRate: views > 0 ? Number(agg?.verifiedViews ?? 0) / views : 0,
          avgRetentionMs: Math.round(Number(agg?.avgRetentionMs ?? 0)),
        };
      }),
    );
    return withStats;
  });

  app.post("/advertiser/campaigns", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const body = campaignInputSchema.parse(req.body);

    const [advertiser] = await ctx.db
      .select()
      .from(advertisers)
      .where(eq(advertisers.id, auth.advertiserId))
      .limit(1);
    const ageDays = advertiser
      ? (Date.now() - advertiser.createdAt.getTime()) / 86_400_000
      : 0;
    const rejected = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(campaigns)
      .where(and(eq(campaigns.advertiserId, auth.advertiserId), eq(campaigns.status, "rejected")));
    const approved = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(campaigns)
      .where(and(eq(campaigns.advertiserId, auth.advertiserId), eq(campaigns.status, "active")));

    // Laya auto-moderation.
    const moderation = await moderateCampaign({
      headline: body.headline,
      bodyText: body.bodyText,
      ctaText: body.ctaText,
      targetUrl: body.targetUrl,
      advertiserAgeDays: ageDays,
      advertiserRejectedCount: Number(rejected[0]?.count ?? 0),
      advertiserApprovedCount: Number(approved[0]?.count ?? 0),
    });

    const status =
      moderation.decision === "auto_approved"
        ? "active"
        : moderation.decision === "auto_rejected"
          ? "rejected"
          : "draft"; // needs_review sits in draft until a human acts

    const [campaign] = await ctx.db
      .insert(campaigns)
      .values({
        advertiserId: auth.advertiserId,
        name: body.name,
        status,
        headline: body.headline,
        bodyText: body.bodyText,
        ctaText: body.ctaText,
        targetUrl: body.targetUrl,
        dailyBudgetMicro: BigInt(body.dailyBudgetMicro),
        cpiMicro: BigInt(body.cpiMicro),
        targetPlatforms: body.targetPlatforms,
        targetGeoClusters: body.targetGeoClusters,
        maxPerDayPerUser: body.maxPerDayPerUser,
        cooldownSec: body.cooldownSec,
        moderationDecision: moderation.decision,
        moderationScore: moderation.score,
        moderationReasons: moderation.reasons,
        moderatedAt: new Date(),
      })
      .returning();
    return { campaign, moderation };
  });

  app.post("/advertiser/campaigns/:id/activate", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const { id } = req.params as { id: string };
    const [existing] = await ctx.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.advertiserId, auth.advertiserId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    // Fail closed: an advertiser cannot self-approve content that moderation
    // left in review or rejected. A human reviewer must clear it first.
    if (existing.moderationDecision !== "auto_approved") {
      return reply.code(409).send({ error: "moderation_required", decision: existing.moderationDecision });
    }
    const [campaign] = await ctx.db
      .update(campaigns)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(campaigns.id, id), eq(campaigns.advertiserId, auth.advertiserId)))
      .returning();
    return campaign;
  });

  app.get("/advertiser/campaigns/:id/stats", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const { id } = req.params as { id: string };

    const [campaign] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (!campaign || campaign.advertiserId !== auth.advertiserId) {
      return reply.code(404).send({ error: "not_found" });
    }

    const [agg] = await ctx.db
      .select({
        impressions: sql<number>`count(*)`,
        verifiedViews: sql<number>`count(*) filter (where ${impressions.earned})`,
        avgVisibleMs: sql<number>`coalesce(avg(${impressions.cumulativeVisibleMs}), 0)`,
      })
      .from(impressions)
      .where(eq(impressions.campaignId, id));
    const [clicks] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(clickEvents)
      .where(eq(clickEvents.campaignId, id));

    const impressionCount = Number(agg?.impressions ?? 0);
    const verifiedViews = Number(agg?.verifiedViews ?? 0);
    const clickCount = Number(clicks?.count ?? 0);

    const stats: CampaignStats = {
      campaignId: id,
      impressions: impressionCount,
      verifiedViews,
      completionRate: impressionCount > 0 ? verifiedViews / impressionCount : 0,
      clicks: clickCount,
      ctr: impressionCount > 0 ? clickCount / impressionCount : 0,
      spendMicro: Number(campaign.spentTotalMicro),
      avgVisibleMs: Math.round(Number(agg?.avgVisibleMs ?? 0)),
    };
    return stats;
  });

  app.post("/ads/click", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    if (!rateLimit(req, reply, "ad_click", 60, 60_000, auth.userId)) return;
    const body = clickEventSchema.parse(req.body);

    // A click is only meaningful when it is signed by the server and belongs
    // to a verified impression owned by this user. Never parse-and-trust.
    const verification = await verifyLeaseToken(
      body.leaseToken,
      ctx.env.LEASE_HMAC_SECRET,
      Math.floor(Date.now() / 1000),
    );
    if (!verification.ok || !verification.payload) {
      return reply.code(400).send({ error: "invalid_lease" });
    }
    const lease = verification.payload;
    if (lease.uid !== auth.userId) return reply.code(403).send({ error: "lease_user_mismatch" });

    // The lease is the authority. A click can arrive before the batched
    // telemetry flush, so an absent impression is allowed; an existing
    // impression must belong to this user, this lease, and be paid.
    const [impression] = await ctx.db
      .select({ id: impressions.id, campaignId: impressions.campaignId, earned: impressions.earned })
      .from(impressions)
      .where(and(eq(impressions.leaseId, lease.lid), eq(impressions.userId, auth.userId)))
      .limit(1);
    if (impression) {
      if (!impression.earned) return reply.code(409).send({ error: "impression_not_verified" });
      if (impression.campaignId !== lease.cid) return reply.code(409).send({ error: "campaign_mismatch" });
      if (impression.id !== body.impressionId) return reply.code(409).send({ error: "impression_mismatch" });
    }

    // Geo from request IP; raw IP is resolved to a cluster and discarded.
    const geo = resolveGeo(req.ip);
    const inserted = await ctx.db
      .insert(clickEvents)
      .values({
        impressionId: impression?.id ?? null,
        leaseId: lease.lid,
        campaignId: lease.cid,
        userId: auth.userId,
        geoCluster: geo.cluster,
      })
      .onConflictDoNothing()
      .returning({ id: clickEvents.id });
    return { ok: true, duplicate: inserted.length === 0 };
  });

  /* ------------------- advertiser analytics (per geo) ------------------- */
  app.get("/advertiser/campaigns/:id/analytics", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const { id } = req.params as { id: string };

    const [campaign] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (!campaign || campaign.advertiserId !== auth.advertiserId) {
      return reply.code(404).send({ error: "not_found" });
    }

    const [totals] = await ctx.db
      .select({
        views: sql<number>`count(*)`,
        verifiedViews: sql<number>`count(*) filter (where ${impressions.earned})`,
        uniqueUsers: sql<number>`count(distinct ${impressions.userId})`,
        intentionalHovers: sql<number>`count(*) filter (where ${impressions.hoverIntentional})`,
        avgRetentionMs: sql<number>`coalesce(avg(${impressions.cumulativeVisibleMs}), 0)`,
      })
      .from(impressions)
      .where(eq(impressions.campaignId, id));
    const [clicks] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(clickEvents)
      .where(eq(clickEvents.campaignId, id));

    const views = Number(totals?.views ?? 0);
    const clicksCount = Number(clicks?.count ?? 0);

    // Per-geo-cluster breakdown. Only cluster labels and counts — never IPs.
    const geoRows = await ctx.db
      .select({
        geoCluster: impressions.geoCluster,
        uniqueUsers: sql<number>`count(distinct ${impressions.userId})`,
        views: sql<number>`count(*)`,
        verifiedViews: sql<number>`count(*) filter (where ${impressions.earned})`,
        intentionalHovers: sql<number>`count(*) filter (where ${impressions.hoverIntentional})`,
        totalHoverMs: sql<number>`coalesce(sum(${impressions.hoverMs}), 0)`,
        avgRetentionMs: sql<number>`coalesce(avg(${impressions.cumulativeVisibleMs}), 0)`,
      })
      .from(impressions)
      .where(eq(impressions.campaignId, id))
      .groupBy(impressions.geoCluster);

    const geoClicks = await ctx.db
      .select({
        geoCluster: clickEvents.geoCluster,
        clicks: sql<number>`count(*)`,
      })
      .from(clickEvents)
      .where(eq(clickEvents.campaignId, id))
      .groupBy(clickEvents.geoCluster);
    const clicksByGeo = new Map(geoClicks.map((r) => [r.geoCluster ?? "XX-UNKNOWN", Number(r.clicks)]));

    const geo = geoRows.map((r) => {
      const cluster = r.geoCluster ?? "XX-UNKNOWN";
      return {
        geoCluster: cluster,
        uniqueUsers: Number(r.uniqueUsers),
        views: Number(r.views),
        verifiedViews: Number(r.verifiedViews),
        intentionalHovers: Number(r.intentionalHovers),
        totalHoverMs: Number(r.totalHoverMs),
        clicks: clicksByGeo.get(cluster) ?? 0,
        avgRetentionMs: Math.round(Number(r.avgRetentionMs)),
      };
    });

    return {
      campaignId: id,
      totals: {
        views,
        verifiedViews: Number(totals?.verifiedViews ?? 0),
        uniqueUsers: Number(totals?.uniqueUsers ?? 0),
        intentionalHovers: Number(totals?.intentionalHovers ?? 0),
        clicks: clicksCount,
        ctr: views > 0 ? clicksCount / views : 0,
        avgRetentionMs: Math.round(Number(totals?.avgRetentionMs ?? 0)),
        completionRate: views > 0 ? Number(totals?.verifiedViews ?? 0) / views : 0,
        spendMicro: Number(campaign.spentTotalMicro),
      },
      geo,
    };
  });
}
