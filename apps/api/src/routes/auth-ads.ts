import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, gte, inArray, ne, or, sql } from "drizzle-orm";
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import {
  LEASE,
  EXTENSION_CACHE,
  prefetchRequestSchema,
  refreshTokenSchema,
  registerUserSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  signLeaseToken,
  type LeaseTokenPayload,
  type PrefetchedAd,
  type PrefetchResponse,
  type PacingState,
  WELCOME_BONUS_USD,
  sha256Hex,
} from "@meantime/shared";
import {
  adLeases,
  authSessions,
  campaigns,
  campaignVariants,
  devices,
  emailVerifications,
  impressions,
  referrals,
  userNetworkEvents,
  users,
} from "@meantime/shared/db";
import {
  campaignWeight,
  filterSelectable,
  weightedSample,
  type SelectionHistory,
} from "../ads-selection.js";
import type { AppContext } from "../context.js";
import { randomToken, signAuthToken, requireUser } from "../context.js";
import { ACCOUNTS, postTransfer } from "../ledger.js";
import { pacingFor } from "../fraud/cadence.js";
import { clusterForIp, resolveGeo } from "../geo.js";
import { checkReferralAllowed } from "../referrals.js";
import { logFraud } from "../fraud/trust.js";
import { rateLimit } from "../rate-limit.js";
import { sendVerificationEmail } from "../email.js";

const ACCESS_TTL_SECONDS = 60 * 60 * 24 * 30;
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Persist a refresh session and return the raw token (only the hash is stored). */
async function issueSession(
  ctx: AppContext,
  userId: string,
  deviceId: string | null,
): Promise<{ refreshToken: string; expiresAt: Date }> {
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await ctx.db.insert(authSessions).values({
    userId,
    deviceId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    expiresAt,
  });
  return { refreshToken, expiresAt };
}

/** Record a geo/network signal for fraud scoring. Raw IP is hashed, never stored. */
async function recordNetworkEvent(ctx: AppContext, userId: string, ip: string): Promise<void> {
  const geo = resolveGeo(ip, ctx.env.IP_HASH_SALT);
  const today = new Date().toISOString().slice(0, 10);
  await ctx.db
    .insert(userNetworkEvents)
    .values({
      userId,
      ipHash: geo.ipHash,
      geoCluster: geo.cluster,
      asn: geo.asn,
      seenOn: today,
    })
    .onConflictDoNothing();
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/auth/register", async (req, reply) => {
    if (!rateLimit(req, reply, "auth_register", 8, 600_000)) return;
    const body = registerUserSchema.parse(req.body);
    const existing = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing.length > 0) return reply.code(409).send({ error: "email_taken" });

    const passwordHash = await argon2.hash(body.password);
    const ip = req.ip;
    // Resolve in memory at the edge and persist only the salted hash, so the
    // sybil/self-referral equality checks keep working without a raw IP ever
    // reaching the database.
    const geo = resolveGeo(ip, ctx.env.IP_HASH_SALT);
    const [user] = await ctx.db
      .insert(users)
      .values({
        email: body.email,
        passwordHash,
        displayName: body.displayName ?? null,
        signupIpHash: geo.ipHash,
      })
      .returning();
    if (!user) return reply.code(500).send({ error: "create_failed" });

    let deviceId: string | null = null;
    let fingerprintHash: string | null = null;
    if (body.deviceId && body.fingerprintHash) {
      fingerprintHash = await sha256Hex(body.fingerprintHash);
      const [device] = await ctx.db
        .insert(devices)
        .values({ userId: user.id, fingerprintHash, userAgent: req.headers["user-agent"] ?? null })
        .onConflictDoNothing()
        .returning();
      deviceId = device?.id ?? null;
    }

    // Referral attribution, with self-referral blocked by network/device checks.
    if (body.referralCode) {
      const match = await ctx.db
        .select({ id: users.id })
        .from(users)
        // Core `sha256(bytea)` (Postgres 11+) avoids depending on pgcrypto.
        .where(
          sql`encode(sha256(convert_to('referral:' || ${users.id}::text, 'UTF8')), 'hex') LIKE ${body.referralCode.toLowerCase() + "%"}`,
        )
        .limit(1);
      const referrer = match[0];
      if (referrer && referrer.id !== user.id) {
        const ipHash = geo.ipHash;
        const check = await checkReferralAllowed(ctx.db, {
          referrerId: referrer.id,
          referredIpHash: ipHash,
          referredFingerprintHash: fingerprintHash,
        });
        if (check.eligible) {
          await ctx.db.insert(referrals).values({
            referrerId: referrer.id,
            referredUserId: user.id,
            referredIpHash: ipHash,
            referredFingerprintHash: fingerprintHash,
          });
        } else {
          await logFraud(ctx.db, {
            userId: user.id,
            severity: "warning",
            rule: "self_referral_blocked",
            detail: { referrerId: referrer.id, reason: check.reason },
          });
        }
      }
    }

    // Welcome bonus: promo liability -> pending balance, unlockable at threshold.
    await ctx.db.transaction(async (tx) => {
      await postTransfer(tx, {
        entryType: "welcome_bonus",
        from: ACCOUNTS.platformPromoLiability,
        to: ACCOUNTS.userPending(user.id),
        amountMicro: BigInt(WELCOME_BONUS_USD),
        referenceType: "user",
        referenceId: user.id,
        memo: "Welcome bonus (pending until $5 threshold)",
      });
      await tx.update(users).set({ welcomeBonusCredited: true }).where(eq(users.id, user.id));
    });

    const accessToken = signAuthToken(
      { sub: user.id, kind: "user", did: deviceId ?? undefined },
      ctx.env.JWT_SECRET,
      ACCESS_TTL_SECONDS,
    );
    const session = await issueSession(ctx, user.id, deviceId);
    await recordNetworkEvent(ctx, user.id, ip);

    // Issue email verification token and attempt sending verification email
    const verifyToken = randomBytes(32).toString("hex");
    const verifyTokenHash = createHash("sha256").update(verifyToken).digest("hex");
    const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await ctx.db.insert(emailVerifications).values({
      userId: user.id,
      tokenHash: verifyTokenHash,
      expiresAt: verifyExpiresAt,
    });
    void sendVerificationEmail({
      to: user.email,
      token: verifyToken,
      webOrigin: ctx.env.WEB_ORIGIN,
      env: ctx.env,
    });

    return {
      userId: user.id,
      deviceId,
      accessToken,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.expiresAt.getTime(),
      emailVerified: false,
    };
  });

  app.post("/auth/login", async (req, reply) => {
    if (!rateLimit(req, reply, "auth_login", 10, 600_000)) return;
    const body = loginSchema.parse(req.body);
    const [user] = await ctx.db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || !(await argon2.verify(user.passwordHash, body.password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    let deviceId: string | null = null;
    if (body.deviceId && body.fingerprintHash) {
      const fp = await sha256Hex(body.fingerprintHash);
      const [device] = await ctx.db
        .insert(devices)
        .values({ userId: user.id, fingerprintHash: fp, userAgent: req.headers["user-agent"] ?? null })
        .onConflictDoUpdate({
          target: [devices.userId, devices.fingerprintHash],
          set: { lastSeenAt: new Date() },
        })
        .returning();
      deviceId = device?.id ?? null;
    }
    const accessToken = signAuthToken(
      { sub: user.id, kind: "user", did: deviceId ?? undefined },
      ctx.env.JWT_SECRET,
      ACCESS_TTL_SECONDS,
    );
    const session = await issueSession(ctx, user.id, deviceId);
    await recordNetworkEvent(ctx, user.id, req.ip);
    return {
      userId: user.id,
      deviceId,
      accessToken,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.expiresAt.getTime(),
      emailVerified: user.emailVerified,
    };
  });

  app.post("/auth/verify-email", async (req, reply) => {
    if (!rateLimit(req, reply, "auth_verify_email", 15, 600_000)) return;
    const body = verifyEmailSchema.parse(req.body);
    const hash = createHash("sha256").update(body.token).digest("hex");

    const [record] = await ctx.db
      .select()
      .from(emailVerifications)
      .where(and(eq(emailVerifications.tokenHash, hash), gt(emailVerifications.expiresAt, new Date())))
      .limit(1);

    if (!record) {
      return reply.code(400).send({ error: "invalid_or_expired_token" });
    }

    await ctx.db.transaction(async (tx) => {
      await tx.update(users).set({ emailVerified: true }).where(eq(users.id, record.userId));
      await tx.delete(emailVerifications).where(eq(emailVerifications.userId, record.userId));
    });

    return { ok: true, message: "Email verified successfully." };
  });

  app.post("/auth/resend-verification", async (req, reply) => {
    if (!rateLimit(req, reply, "auth_resend_verification", 5, 600_000)) return;
    const body = resendVerificationSchema.parse(req.body ?? {});
    let targetUserId: string | null = null;
    let targetEmail: string | null = null;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const claims = requireUser(req, reply, ctx.env.JWT_SECRET);
      if (claims?.userId) {
        targetUserId = claims.userId;
      }
    }

    if (targetUserId) {
      const [u] = await ctx.db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
      if (u) {
        targetEmail = u.email;
        if (u.emailVerified) {
          return reply.code(400).send({ error: "already_verified" });
        }
      }
    } else if (body.email) {
      const [u] = await ctx.db.select().from(users).where(eq(users.email, body.email)).limit(1);
      if (u) {
        targetUserId = u.id;
        targetEmail = u.email;
        if (u.emailVerified) {
          return reply.code(400).send({ error: "already_verified" });
        }
      } else {
        return { ok: true, message: "Verification email sent if account exists." };
      }
    } else {
      return reply.code(400).send({ error: "missing_email_or_token" });
    }

    if (!targetUserId || !targetEmail) {
      return { ok: true, message: "Verification email sent if account exists." };
    }

    const verifyToken = randomBytes(32).toString("hex");
    const verifyTokenHash = createHash("sha256").update(verifyToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await ctx.db.transaction(async (tx) => {
      await tx.delete(emailVerifications).where(eq(emailVerifications.userId, targetUserId!));
      await ctx.db.insert(emailVerifications).values({
        userId: targetUserId!,
        tokenHash: verifyTokenHash,
        expiresAt,
      });
    });

    void sendVerificationEmail({
      to: targetEmail,
      token: verifyToken,
      webOrigin: ctx.env.WEB_ORIGIN,
      env: ctx.env,
    });

    return { ok: true, message: "Verification email sent." };
  });

  /**
   * Rotate a refresh token: the presented session is revoked and replaced in
   * the same transaction. A reused (already rotated) token fails closed, which
   * makes token theft detectable rather than silently accepted.
   */
  app.post("/auth/refresh", async (req, reply) => {
    if (!rateLimit(req, reply, "auth_refresh", 60, 60_000)) return;
    const body = refreshTokenSchema.parse(req.body);
    const hash = hashRefreshToken(body.refreshToken);

    const [session] = await ctx.db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.refreshTokenHash, hash),
          sql`${authSessions.revokedAt} IS NULL`,
          gt(authSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session) return reply.code(401).send({ error: "invalid_refresh_token" });

    const rotated = await ctx.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.id, session.id), sql`${authSessions.revokedAt} IS NULL`))
        .returning({ id: authSessions.id });
      if (!revoked) return null; // another request rotated it first

      const refreshToken = randomToken();
      const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
      await tx.insert(authSessions).values({
        userId: session.userId,
        deviceId: session.deviceId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt,
      });
      return { refreshToken, expiresAt };
    });
    if (!rotated) return reply.code(401).send({ error: "invalid_refresh_token" });

    const accessToken = signAuthToken(
      { sub: session.userId, kind: "user", did: session.deviceId ?? undefined },
      ctx.env.JWT_SECRET,
      ACCESS_TTL_SECONDS,
    );
    return {
      userId: session.userId,
      deviceId: session.deviceId,
      accessToken,
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.expiresAt.getTime(),
    };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (!rateLimit(req, reply, "auth_logout", 60, 60_000)) return;
    const body = refreshTokenSchema.parse(req.body);
    await ctx.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authSessions.refreshTokenHash, hashRefreshToken(body.refreshToken)),
          sql`${authSessions.revokedAt} IS NULL`,
        ),
      );
    return { ok: true };
  });
}

export async function adsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/ads/prefetch", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    if (!rateLimit(req, reply, "prefetch", 60, 60_000, auth.userId)) return;

    const body = prefetchRequestSchema.parse(req.body);
    const count = Math.min(body.count, EXTENSION_CACHE.PREFETCH_BATCH_SIZE);
    const nowSec = Math.floor(Date.now() / 1000);

    // Server-side pacing state (Layer 4) from the last hour of impressions.
    const hourAgo = new Date(Date.now() - 3600_000);
    const [promptRow] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(adLeases)
      .where(and(eq(adLeases.userId, auth.userId), gt(adLeases.consumedAt, hourAgo)));
    const promptsLastHour = Number(promptRow?.count ?? 0);
    const pacing = pacingFor(promptsLastHour);

    const pacingState: PacingState = {
      tier: pacing.tier,
      remainingThisHour: pacing.remainingThisHour,
      promptDivisor: pacing.promptDivisor,
    };
    if (!pacing.allow) {
      const empty: PrefetchResponse = { ads: [], pacing: pacingState, serverTime: Date.now() };
      return empty;
    }

    // Eligible campaigns: active, budget remaining today, platform- and
    // geo-targeted. Geo is matched on the request IP's cluster; the raw IP
    // is never stored or returned.
    const today = new Date().toISOString().slice(0, 10);
    const userCluster = clusterForIp(req.ip, ctx.env.IP_HASH_SALT);
    const rows = await ctx.db
      .select()
      .from(campaigns)
      .where(
        or(
          eq(campaigns.status, "active"),
          and(eq(campaigns.status, "exhausted"), or(sql`${campaigns.spendDate} is null`, ne(campaigns.spendDate, today))),
        ),
      )
      .orderBy(desc(campaigns.cpiMicro))
      // Over-fetch because geo/platform/duration filters run in memory. Too
      // small a window starves the later filtering and returns a short batch.
      .limit(Math.min(200, count * 10));

    const eligible = rows.filter((c) => {
      if (c.spendDate === today && c.spentTodayMicro >= c.dailyBudgetMicro) return false;
      if (body.maxDurationSec && (c.durationSec ?? 5) > body.maxDurationSec) return false;
      if (body.platforms.length > 0) {
        const targets = (c.targetPlatforms as string[]) ?? [];
        if (targets.length > 0 && !targets.some((p) => body.platforms.includes(p))) return false;
      }
      const geoTargets = (c.targetGeoClusters as string[]) ?? [];
      if (geoTargets.length > 0 && userCluster !== "XX-LOCAL" && !geoTargets.includes(userCluster)) return false;
      return true;
    });

    // Server-side per-user frequency + cooldown, mirroring the extension's
    // local cache filter. Without this, clearing extension storage (or a second
    // device) would defeat the per-day cap and let one campaign dominate.
    const dayAgo = new Date(Date.now() - 86_400_000);
    const recent = await ctx.db
      .select({
        campaignId: impressions.campaignId,
        views: sql<number>`count(*)`,
        lastShownAt: sql<Date>`max(${impressions.createdAt})`,
      })
      .from(impressions)
      .where(and(eq(impressions.userId, auth.userId), gte(impressions.createdAt, dayAgo)))
      .groupBy(impressions.campaignId);
    const history = new Map<string, SelectionHistory>();
    for (const row of recent) {
      const last = row.lastShownAt instanceof Date ? row.lastShownAt.getTime() : new Date(row.lastShownAt).getTime();
      history.set(row.campaignId, { views: Number(row.views), lastShownAt: last });
    }

    const selectable = filterSelectable(
      eligible,
      history,
      Date.now(),
      today,
      new Set(body.excludeCampaignIds),
    );

    const [device] = auth.deviceId
      ? await ctx.db.select().from(devices).where(eq(devices.id, auth.deviceId)).limit(1)
      : [null];

    // Bid-weighted sample without replacement: honest rotation across the
    // eligible pool instead of the same top-bid campaign filling every lease.
    const chosenCampaigns = weightedSample(
      selectable,
      (campaign) => campaignWeight(campaign, history, today),
      count,
    );
    // One query for every selected campaign's approved variants instead of an
    // N+1 per campaign in the prefetch hot path.
    const variantRows =
      chosenCampaigns.length > 0
        ? await ctx.db
            .select()
            .from(campaignVariants)
            .where(
              and(
                inArray(
                  campaignVariants.campaignId,
                  chosenCampaigns.map((c) => c.id),
                ),
                eq(campaignVariants.moderationDecision, "auto_approved"),
              ),
            )
        : [];
    const variantsByCampaign = new Map<string, typeof variantRows>();
    for (const variant of variantRows) {
      const list = variantsByCampaign.get(variant.campaignId);
      if (list) list.push(variant);
      else variantsByCampaign.set(variant.campaignId, [variant]);
    }

    const ads: PrefetchedAd[] = [];
    for (const campaign of chosenCampaigns) {
      // A/B rotation: pick the base copy or an approved variant at random.
      const approvedVariants = variantsByCampaign.get(campaign.id) ?? [];
      const pick =
        approvedVariants.length > 0 && Math.random() < approvedVariants.length / (approvedVariants.length + 1)
          ? approvedVariants[Math.floor(Math.random() * approvedVariants.length)]
          : null;

      const copy = pick ?? campaign;
      const leaseId = crypto.randomUUID();
      const payload: LeaseTokenPayload = {
        v: 1,
        lid: leaseId,
        uid: auth.userId,
        did: device?.id ?? body.deviceId,
        aid: campaign.id,
        cid: campaign.id,
        iat: nowSec,
        exp: nowSec + LEASE.TTL_SECONDS,
        dur: campaign.durationSec ?? 5,
      };
      const leaseToken = await signLeaseToken(payload, ctx.env.LEASE_HMAC_SECRET);
      await ctx.db.insert(adLeases).values({
        id: leaseId,
        userId: auth.userId,
        deviceId: device?.id ?? null,
        campaignId: campaign.id,
        expiresAt: new Date((nowSec + LEASE.TTL_SECONDS) * 1000),
      });
      ads.push({
        adId: campaign.id,
        campaignId: campaign.id,
        variantId: pick?.id ?? null,
        variantLabel: pick?.label ?? "A",
        leaseId,
        leaseToken,
        issuedAt: nowSec,
        expiresAt: nowSec + LEASE.TTL_SECONDS,
        cpiMicro: campaign.cpiMicro.toString(),
        durationSec: campaign.durationSec ?? 5,
        headline: copy.headline,
        bodyText: copy.bodyText,
        ctaText: copy.ctaText,
        targetUrl: campaign.targetUrl,
        targetPlatforms: (campaign.targetPlatforms as string[]) ?? [],
        frequencyCap: {
          maxPerDay: campaign.maxPerDayPerUser,
          cooldownSec: campaign.cooldownSec,
        },
      });
    }

    const response: PrefetchResponse = { ads, pacing: pacingState, serverTime: Date.now() };
    return response;
  });
}
