import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import {
  MIN_VIEWABLE_MS,
  REVENUE_SHARE,
  telemetryBatchSchema,
  verifyLeaseToken,
  type ImpressionEvent,
  type TelemetryBatchResponse,
  type TelemetryEventResult,
} from "@meantime/shared";
import { adLeases, campaigns, impressions, telemetryBatches } from "@meantime/shared/db";
import type { AppContext } from "../context.js";
import { requireUser } from "../context.js";
import { ACCOUNTS, postTransfer } from "../ledger.js";
import { analyzeCadence, type CadenceFinding } from "../fraud/cadence.js";
import { logFraud } from "../fraud/trust.js";
import { clusterForIp } from "../geo.js";
import { maybeQualifyReferral } from "../referrals.js";
import { rateLimit } from "../rate-limit.js";

export async function telemetryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/telemetry/batch", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    if (!rateLimit(req, reply, "telemetry", 30, 60_000, auth.userId)) return;
    const userId = auth.userId;

    const batch = telemetryBatchSchema.parse(req.body);
    const geoCluster = clusterForIp(req.ip);

    // Pull the last hour of history for cadence analysis.
    const hourAgo = new Date(Date.now() - 3600_000);
    const recent = await ctx.db
      .select({
        submittedAt: impressions.submittedAt,
        cumulativeVisibleMs: impressions.cumulativeVisibleMs,
      })
      .from(impressions)
      .where(and(eq(impressions.userId, userId), gte(impressions.createdAt, hourAgo)))
      .orderBy(desc(impressions.createdAt))
      .limit(200);

    const findings: CadenceFinding[] = analyzeCadence(
      batch.events as ImpressionEvent[],
      recent.map((r) => r.submittedAt.getTime()),
      recent.map((r) => r.cumulativeVisibleMs),
    );
    const criticalFindings = findings.filter((f) => f.severity === "critical");

    const [batchRow] = await ctx.db
      .insert(telemetryBatches)
      .values({
        userId,
        deviceId: auth.deviceId ?? null,
        extensionVersion: batch.extensionVersion,
        eventCount: batch.events.length,
        acceptedCount: 0,
        cadenceFindings: findings.map((f) => f.rule),
      })
      .returning();
    if (!batchRow) return reply.code(500).send({ error: "batch_failed" });

    const results: TelemetryEventResult[] = [];
    let accepted = 0;
    let flagged = 0;

    for (const event of batch.events) {
      const result = await processEvent(ctx, userId, batchRow.id, event, criticalFindings, geoCluster);
      results.push(result);
      if (result.status === "verified") accepted++;
      if (result.status === "flagged") flagged++;
    }

    await ctx.db
      .update(telemetryBatches)
      .set({ acceptedCount: accepted, flaggedCount: flagged })
      .where(eq(telemetryBatches.id, batchRow.id));

    for (const f of findings) {
      await logFraud(ctx.db, {
        userId,
        severity: f.severity,
        rule: f.rule,
        detail: f.detail,
      });
    }

    const response: TelemetryBatchResponse = { accepted, results };
    return response;
  });
}

/**
 * One event, settled exactly once.
 *
 * Ordering is deliberate:
 *  1. Verify the lease HMAC and bind it to the authenticated user.
 *  2. Claim the lease with a single conditional UPDATE. Two concurrent
 *     submissions cannot both win, whether or not Redis is reachable.
 *  3. Score PoHI / viewport / cadence.
 *  4. For a payable view, lock the campaign row, enforce its daily budget,
 *     insert the impression (client UUID is the idempotency key), post the
 *     ledger transfers and update spend inside one transaction.
 *
 * A crash between steps loses at most one lease; it can never double-pay.
 */
async function processEvent(
  ctx: AppContext,
  userId: string,
  batchId: string,
  event: ImpressionEvent,
  batchCriticalFindings: CadenceFinding[],
  geoCluster: string,
): Promise<TelemetryEventResult> {
  const reasons: string[] = [];

  /* ---- Layer 1: cryptographic lease validation ---- */
  const verification = await verifyLeaseToken(
    event.leaseToken,
    ctx.env.LEASE_HMAC_SECRET,
    Math.floor(Date.now() / 1000),
  );
  if (!verification.ok || !verification.payload) {
    reasons.push(`lease_${verification.reason ?? "invalid"}`);
    // No verified campaign id, so there is nothing safe to attach the row to.
    return { impressionId: event.impressionId, status: "rejected", earnedMicro: 0, reasons };
  }
  const lease = verification.payload;
  if (lease.uid !== userId) {
    reasons.push("lease_user_mismatch");
    return { impressionId: event.impressionId, status: "rejected", earnedMicro: 0, reasons };
  }

  // Single-use enforcement is the DB row itself. Redis would only be a cache:
  // marking it first can reject a lease whose DB write never happened.
  const claimed = await ctx.db
    .update(adLeases)
    .set({ consumedAt: new Date(), consumedImpressionId: event.impressionId })
    .where(and(eq(adLeases.id, lease.lid), isNull(adLeases.consumedAt)))
    .returning({ campaignId: adLeases.campaignId });

  const claimedRow = claimed[0];
  if (!claimedRow) {
    reasons.push("lease_already_consumed");
    await persist(ctx, batchId, userId, event, lease.lid, "rejected", reasons, 0n, lease.cid, geoCluster);
    return { impressionId: event.impressionId, status: "rejected", earnedMicro: 0, reasons };
  }
  const campaignId = claimedRow.campaignId;
  if (campaignId !== lease.cid) {
    reasons.push("lease_campaign_mismatch");
    await persist(ctx, batchId, userId, event, lease.lid, "rejected", reasons, 0n, campaignId, geoCluster);
    return { impressionId: event.impressionId, status: "rejected", earnedMicro: 0, reasons };
  }

  /* ---- Layer 2: proof of human interaction ---- */
  if (event.pohi.inputInteractionScore < 0.25) reasons.push("no_trusted_input");
  if (!event.pohi.aiMutationVerified) reasons.push("no_ai_mutation");

  /* ---- Threshold & batch-level cadence ---- */
  const viewableEnough = event.cumulativeVisibleMs >= MIN_VIEWABLE_MS;
  if (!viewableEnough) reasons.push("below_threshold");
  if (batchCriticalFindings.length > 0) reasons.push(...batchCriticalFindings.map((f) => f.rule));

  const verified = reasons.length === 0 && viewableEnough;
  const status: "verified" | "rejected" | "flagged" = verified
    ? "verified"
    : batchCriticalFindings.length > 0
      ? "flagged"
      : "rejected";

  if (!verified) {
    await persist(ctx, batchId, userId, event, lease.lid, status, reasons, 0n, campaignId, geoCluster);
    return { impressionId: event.impressionId, status, earnedMicro: 0, reasons };
  }

  /* ---- Revenue share (55/45) on verified views, budget-gated ---- */
  const settlement = await ctx.db.transaction(async (tx) => {
    // Lock the campaign so concurrent views cannot both spend the last dollar.
    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for("update")
      .limit(1);
    if (!campaign) return { ok: false as const, reason: "campaign_missing" };

    const today = new Date().toISOString().slice(0, 10);
    const spentToday = campaign.spendDate === today ? campaign.spentTodayMicro : 0n;
    if (spentToday + campaign.cpiMicro > campaign.dailyBudgetMicro) {
      return { ok: false as const, reason: "campaign_budget_exhausted" };
    }

    const earnedMicro = (campaign.cpiMicro * BigInt(REVENUE_SHARE.USER_BPS)) / 10_000n;
    const platformMicro = campaign.cpiMicro - earnedMicro;

    // Idempotency gate: the client UUID is the primary key. A duplicate event
    // (even one carrying a different valid lease) cannot credit twice.
    const inserted = await tx
      .insert(impressions)
      .values({
        id: event.impressionId,
        batchId,
        leaseId: lease.lid,
        userId,
        campaignId,
        platform: event.platform,
        placement: event.placement,
        displayMode: event.displayMode,
        submittedAt: new Date(event.submittedAt),
        aiWaitDurationMs: Math.round(event.aiWaitDurationMs),
        cumulativeVisibleMs: Math.round(event.cumulativeVisibleMs),
        hoverMs: Math.round(event.hoverMs ?? 0),
        hoverIntentional: event.hoverIntentional ?? false,
        geoCluster,
        earned: true,
        earnedMicro,
        status: "verified",
        rejectionReasons: [],
        pohi: event.pohi,
      })
      .onConflictDoNothing()
      .returning({ id: impressions.id });
    if (inserted.length === 0) return { ok: false as const, reason: "impression_duplicate" };

    await postTransfer(tx, {
      entryType: "advertiser_spend",
      from: ACCOUNTS.advertiser(campaign.advertiserId),
      to: ACCOUNTS.platformFloat,
      amountMicro: campaign.cpiMicro,
      referenceType: "impression",
      referenceId: event.impressionId,
    });
    await postTransfer(tx, {
      entryType: "ad_revenue_share",
      from: ACCOUNTS.platformFloat,
      to: ACCOUNTS.user(userId),
      amountMicro: earnedMicro,
      referenceType: "impression",
      referenceId: event.impressionId,
    });
    await postTransfer(tx, {
      entryType: "ad_revenue_share",
      from: ACCOUNTS.platformFloat,
      to: ACCOUNTS.platformRevenue,
      amountMicro: platformMicro,
      referenceType: "impression",
      referenceId: event.impressionId,
    });

    await tx
      .update(campaigns)
      .set({
        spentTodayMicro: spentToday + campaign.cpiMicro,
        spentTotalMicro: campaign.spentTotalMicro + campaign.cpiMicro,
        spendDate: today,
      })
      .where(eq(campaigns.id, campaign.id));

    // Vesting check runs inside the same transaction as the credit.
    await maybeQualifyReferral(tx, userId);

    return { ok: true as const, earnedMicro };
  });

  if (!settlement.ok) {
    reasons.push(settlement.reason);
    await persist(ctx, batchId, userId, event, lease.lid, "rejected", reasons, 0n, campaignId, geoCluster);
    return { impressionId: event.impressionId, status: "rejected", earnedMicro: 0, reasons };
  }

  return {
    impressionId: event.impressionId,
    status: "verified",
    earnedMicro: Number(settlement.earnedMicro),
    reasons,
  };
}

async function persist(
  ctx: AppContext,
  batchId: string,
  userId: string,
  event: ImpressionEvent,
  leaseId: string,
  status: "verified" | "rejected" | "flagged",
  reasons: string[],
  earnedMicro: bigint,
  campaignId: string | null,
  geoCluster: string = "XX-UNKNOWN",
): Promise<void> {
  if (!campaignId) return;
  try {
    await ctx.db
      .insert(impressions)
      .values({
      id: event.impressionId,
      batchId,
      leaseId,
      userId,
      campaignId,
      platform: event.platform,
      placement: event.placement,
      displayMode: event.displayMode,
      submittedAt: new Date(event.submittedAt),
      aiWaitDurationMs: Math.round(event.aiWaitDurationMs),
      cumulativeVisibleMs: Math.round(event.cumulativeVisibleMs),
      hoverMs: Math.round(event.hoverMs ?? 0),
      hoverIntentional: event.hoverIntentional ?? false,
      geoCluster,
      earned: false,
      earnedMicro,
      status,
      rejectionReasons: reasons,
        pohi: event.pohi,
      })
      .onConflictDoNothing();
  } catch {
    // Audit rows must never turn a settled event into a 500. The authoritative
    // credit (if any) already committed in the settlement transaction.
  }
}
