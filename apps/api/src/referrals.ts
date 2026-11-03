import { and, eq, sql } from "drizzle-orm";
import {
  REFERRAL_QUALIFY_EARNINGS_USD,
  REFERRAL_BONUS_USD,
} from "@meantime/shared";
import {
  type Db,
  devices,
  referrals,
  userNetworkEvents,
} from "@meantime/shared/db";
import type { LedgerTx } from "./ledger.js";
import { ACCOUNTS, balanceOf, postTransfer } from "./ledger.js";

/**
 * Referral anti-fraud. The economics are the first line of defense: a bonus
 * only vests after the referred user earns $1.00 in *verified* views, so a
 * farmed account that never genuinely uses the product pays nothing. On top
 * of that, self-referrals are blocked by network and device identity.
 */

export interface ReferralEligibility {
  eligible: boolean;
  reason?: string;
}

export async function checkReferralAllowed(
  db: Db,
  params: {
    referrerId: string;
    referredIpHash: string | null;
    referredFingerprintHash: string | null;
  },
): Promise<ReferralEligibility> {
  const { referrerId, referredIpHash, referredFingerprintHash } = params;

  // Same fingerprint hash as any device on the referrer's account => self-referral.
  if (referredFingerprintHash) {
    const referrerDevices = await db
      .select({ fingerprintHash: devices.fingerprintHash })
      .from(devices)
      .where(eq(devices.userId, referrerId));
    if (referrerDevices.some((d) => d.fingerprintHash === referredFingerprintHash)) {
      return { eligible: false, reason: "device_matches_referrer" };
    }
  }

  // Same salted IP hash ever seen on the referrer's account => same household/bot.
  if (referredIpHash) {
    const overlap = await db
      .select({ count: sql<number>`count(*)` })
      .from(userNetworkEvents)
      .where(
        and(
          eq(userNetworkEvents.userId, referrerId),
          eq(userNetworkEvents.ipHash, referredIpHash),
        ),
      );
    if (Number(overlap[0]?.count ?? 0) > 0) {
      return { eligible: false, reason: "ip_overlap_with_referrer" };
    }
  }

  return { eligible: true };
}

/**
 * Called inside the same transaction as a verified impression. When the
 * referred user's lifetime verified earnings cross the qualification
 * threshold, the referral pays out once. The conditional UPDATE is the
 * idempotency gate: concurrent impressions can both see `pending`, but only
 * one can flip the row and post the bonus.
 */
export async function maybeQualifyReferral(
  tx: LedgerTx,
  referredUserId: string,
): Promise<boolean> {
  const [referral] = await tx
    .select()
    .from(referrals)
    .where(eq(referrals.referredUserId, referredUserId))
    .limit(1);
  if (!referral || referral.status !== "pending") return false;

  // Lifetime verified earnings = current available + already-withdrawn.
  const earned = await balanceOf(tx, ACCOUNTS.user(referredUserId));
  const qualified = earned >= BigInt(REFERRAL_QUALIFY_EARNINGS_USD);
  if (!qualified) return false;

  const claimed = await tx
    .update(referrals)
    .set({ status: "paid", paidAt: new Date(), qualifiedEarningsMicro: earned })
    .where(and(eq(referrals.id, referral.id), eq(referrals.status, "pending")))
    .returning({ id: referrals.id });
  if (claimed.length === 0) return false; // another settlement already paid it

  await postTransfer(tx, {
    entryType: "referral_bonus",
    from: ACCOUNTS.platformPromoLiability,
    to: ACCOUNTS.user(referral.referrerId),
    amountMicro: BigInt(REFERRAL_BONUS_USD),
    referenceType: "referral",
    referenceId: referral.id,
    memo: "Referral bonus — referred user reached $1.00 in verified views",
  });
  return true;
}
