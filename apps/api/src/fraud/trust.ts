import { and, desc, eq, gte, sql } from "drizzle-orm";
import { TRUST, type TrustScoreBreakdown } from "@meantime/shared";
import {
  type Db,
  fraudLogs,
  impressions,
  payoutDestinations,
  userNetworkEvents,
  users,
} from "@meantime/shared/db";
import type { LedgerTx } from "../ledger.js";

/**
 * Layer 5 — Composite trust score for pre-withdrawal review.
 * Ts ∈ [0, 100]; ≥80 auto-approve, 50–79 manual review, <50 freeze.
 *
 * Accepts the connection or an open transaction handle so the payout flow
 * can compute the score under the user row lock, inside the same
 * transaction that records `trustScoreAtRequest`.
 */
export async function computeTrustScore(
  db: Db | LedgerTx,
  userId: string,
): Promise<TrustScoreBreakdown> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return { total: 0, accountAgeScore: 0, networkScore: 0, payoutUniquenessScore: 0, interactionScore: 0, cadenceScore: 0 };
  }

  // 1. Account age: full marks after 14 days.
  const ageDays = (Date.now() - user.createdAt.getTime()) / 86_400_000;
  const accountAgeScore = Math.min(20, Math.round((ageDays / 14) * 20));

  // 2. Network: a signup IP hash shared with other accounts is a sybil signal,
  //    and implausible geo diversity over a short window is a bot-farm signal.
  //    Only the salted hash is stored, so this compares hashes, never IPs.
  const sharedCount = user.signupIpHash
    ? Number(
        (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(users)
            .where(
              and(eq(users.signupIpHash, user.signupIpHash), sql`${users.id} <> ${userId}`),
            )
        )[0]?.count ?? 0,
      )
    : 0;
  let networkScore = user.signupIpHash
    ? sharedCount === 0
      ? 20
      : sharedCount === 1
        ? 10
        : 0
    : 10; // unknown IP: neutral

  // Geo-velocity: distinct geo clusters over the last 14 days. Humans stay in
  // one or two; a farm account hopping clusters daily scores lower.
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000);
  const geoRows = await db
    .select({ cluster: userNetworkEvents.geoCluster })
    .from(userNetworkEvents)
    .where(and(eq(userNetworkEvents.userId, userId), gte(userNetworkEvents.createdAt, fourteenDaysAgo)));
  const distinctClusters = new Set(geoRows.map((r) => r.cluster)).size;
  if (distinctClusters >= 8) networkScore = 0;
  else if (distinctClusters >= 5) networkScore = Math.min(networkScore, 5);
  else if (distinctClusters >= 3) networkScore = Math.min(networkScore, 12);

  // 3. Payout destination uniqueness: one address = one account.
  const dests = await db
    .select()
    .from(payoutDestinations)
    .where(eq(payoutDestinations.userId, userId));
  let payoutUniquenessScore = 20;
  for (const dest of dests) {
    const others = await db
      .select({ count: sql<number>`count(*)` })
      .from(payoutDestinations)
      .where(
        and(
          eq(payoutDestinations.addressNormalized, dest.addressNormalized),
          sql`${payoutDestinations.userId} <> ${userId}`,
        ),
      );
    if (Number(others[0]?.count ?? 0) > 0) payoutUniquenessScore = 0;
  }

  // 4. Interaction score: average isTrusted-based PoHI over the last 200 impressions.
  const recent = await db
    .select({
      pohi: impressions.pohi,
      cumulativeVisibleMs: impressions.cumulativeVisibleMs,
      submittedAt: impressions.submittedAt,
    })
    .from(impressions)
    .where(eq(impressions.userId, userId))
    .orderBy(desc(impressions.createdAt))
    .limit(200);

  let interactionScore = 10; // neutral with no history
  let cadenceScore = 10;
  if (recent.length >= 5) {
    const avgPohi =
      recent.reduce((acc, r) => {
        const p = r.pohi as { inputInteractionScore?: number };
        return acc + (p.inputInteractionScore ?? 0);
      }, 0) / recent.length;
    interactionScore = Math.round(avgPohi * 20);

    // 5. Cadence: reuse CV over the same window.
    const ts = recent.map((r) => r.submittedAt.getTime()).sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let i = 1; i < ts.length; i++) intervals.push((ts[i] as number) - (ts[i - 1] as number));
    if (intervals.length >= 14) {
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const std = Math.sqrt(
        intervals.reduce((a, v) => a + (v - mean) ** 2, 0) / intervals.length,
      );
      const cv = mean > 0 ? std / mean : 0;
      cadenceScore = cv >= 0.35 ? 20 : cv >= 0.15 ? 12 : cv >= 0.08 ? 5 : 0;
    }
  }

  const total = Math.max(
    0,
    Math.min(100, accountAgeScore + networkScore + payoutUniquenessScore + interactionScore + cadenceScore),
  );

  return {
    total,
    accountAgeScore,
    networkScore,
    payoutUniquenessScore,
    interactionScore,
    cadenceScore,
  };
}

export type PayoutVerdict = "auto_approve" | "manual_review" | "freeze";

export function verdictFor(score: number): PayoutVerdict {
  if (score >= TRUST.AUTO_APPROVE) return "auto_approve";
  if (score >= TRUST.MANUAL_REVIEW) return "manual_review";
  return "freeze";
}

export async function logFraud(
  db: Db,
  entry: {
    userId?: string;
    severity: "info" | "warning" | "critical";
    rule: string;
    detail: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(fraudLogs).values({
    userId: entry.userId ?? null,
    severity: entry.severity,
    rule: entry.rule,
    detail: entry.detail,
  });
}
