import { sql } from "drizzle-orm";
import { createDb, ledgerEntries } from "@meantime/shared/db";
import { loadEnv } from "../env.js";

/**
 * Ledger reconciliation. Every posting is a balanced pair, so the sum of every
 * row in `ledger_entries` must be exactly zero. Run it after a smoke test or
 * on a schedule; a non-zero exit means the books do not balance and no payout
 * should be settled until they do.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);

  const [overall] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMicro}), 0)` })
    .from(ledgerEntries);
  const total = BigInt(overall?.total ?? "0");

  const byType = await db
    .select({
      entryType: ledgerEntries.entryType,
      entries: sql<number>`count(*)`,
      total: sql<string>`sum(${ledgerEntries.amountMicro})`,
    })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.entryType)
    .orderBy(ledgerEntries.entryType);

  console.log(`ledger entries: ${byType.reduce((n, row) => n + Number(row.entries), 0)}`);
  for (const row of byType) {
    console.log(`  ${row.entryType}: ${row.total} µ$ (${row.entries} rows)`);
  }

  // Assert every individual transaction group sums to zero
  const unbalanced = await db
    .select({
      referenceType: ledgerEntries.referenceType,
      referenceId: ledgerEntries.referenceId,
      count: sql<number>`count(*)`,
      total: sql<string>`sum(${ledgerEntries.amountMicro})`,
    })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.referenceType, ledgerEntries.referenceId)
    .having(sql`sum(${ledgerEntries.amountMicro}) <> 0`);

  if (unbalanced.length > 0) {
    console.error(`\nFAIL: found ${unbalanced.length} unbalanced transaction group(s):`);
    for (const group of unbalanced) {
      console.error(
        `  ${group.referenceType ?? "null"}:${group.referenceId ?? "null"} has ${group.count} entries summing to ${group.total} µ$`,
      );
    }
    process.exit(1);
  }

  if (total !== 0n) {
    console.error(`\nFAIL: ledger sums to ${total} µ$ instead of 0.`);
    process.exit(1);
  }
  console.log("\nOK: ledger is zero-sum across all accounts and per transaction.");
  process.exit(0);
}

void main();
