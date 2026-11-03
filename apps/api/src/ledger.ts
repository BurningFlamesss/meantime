import { sql } from "drizzle-orm";
import type { Db } from "@meantime/shared/db";
import { ledgerEntries } from "@meantime/shared/db";

/**
 * Double-entry ledger. Every movement writes a pair of rows that sum to zero:
 * a credit to one account and a debit to the counter-account. Balances are
 * derived by summing an account's rows — there are no mutable balance columns
 * to drift out of sync.
 */

export const ACCOUNTS = {
  user: (id: string) => `user:${id}`,
  userPending: (id: string) => `user_pending:${id}`,
  advertiser: (id: string) => `advertiser:${id}`,
  platformRevenue: "platform:revenue",
  platformPromoLiability: "platform:promo_liability",
  platformFloat: "platform:float",
} as const;

export type LedgerTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function postEntry(
  tx: LedgerTx,
  entry: {
    entryType:
      | "welcome_bonus"
      | "ad_revenue_share"
      | "social_task_reward"
      | "referral_bonus"
      | "advertiser_deposit"
      | "advertiser_spend"
      | "payout_debit"
      | "adjustment";
    account: string;
    amountMicro: bigint;
    referenceType?: string;
    referenceId?: string;
    memo?: string;
  },
): Promise<void> {
  await tx.insert(ledgerEntries).values({
    entryType: entry.entryType,
    account: entry.account,
    amountMicro: entry.amountMicro,
    referenceType: entry.referenceType ?? null,
    referenceId: entry.referenceId ?? null,
    memo: entry.memo ?? null,
  });
}

/** Post a balanced transfer: `amount` leaves `from`, arrives at `to`. */
export async function postTransfer(
  tx: LedgerTx,
  params: {
    entryType: Parameters<typeof postEntry>[1]["entryType"];
    from: string;
    to: string;
    amountMicro: bigint;
    referenceType?: string;
    referenceId?: string;
    memo?: string;
  },
): Promise<void> {
  await postEntry(tx, {
    entryType: params.entryType,
    account: params.from,
    amountMicro: -params.amountMicro,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    memo: params.memo,
  });
  await postEntry(tx, {
    entryType: params.entryType,
    account: params.to,
    amountMicro: params.amountMicro,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    memo: params.memo,
  });
}

export async function balanceOf(db: Db | LedgerTx, account: string): Promise<bigint> {
  const rows = await db
    .select({ sum: sql<string>`coalesce(sum(${ledgerEntries.amountMicro}), 0)` })
    .from(ledgerEntries)
    .where(sql`${ledgerEntries.account} = ${account}`);
  return BigInt(rows[0]?.sum ?? "0");
}
