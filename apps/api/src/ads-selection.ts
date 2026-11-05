/**
 * Ad selection helpers.
 *
 * Prefetch used to take the top-N campaigns by raw bid. That starves every
 * lower bid and repeatedly serves the same creative until a user's local cap
 * kicks in. Selection is now a bid-weighted sample without replacement, scaled
 * by remaining daily budget, per-user freshness and the campaign's remaining
 * per-day allowance. Higher bids still win more often, but the pool stays
 * diverse and no single campaign can fill an entire batch.
 */

export interface SelectionCampaign {
  id: string;
  cpiMicro: bigint;
  dailyBudgetMicro: bigint;
  spentTodayMicro: bigint;
  /** YYYY-MM-DD the spentTodayMicro counter belongs to. */
  spendDate: string;
  durationSec: number;
  maxPerDayPerUser: number;
  cooldownSec: number;
}

export interface SelectionHistory {
  views: number;
  lastShownAt: number;
}

/** Micro-dollars still available today for a campaign. Never negative. */
export function remainingBudgetMicro(campaign: SelectionCampaign, today: string): bigint {
  const spent = campaign.spendDate === today ? campaign.spentTodayMicro : 0n;
  const left = campaign.dailyBudgetMicro - spent;
  return left > 0n ? left : 0n;
}

/**
 * Return the campaign IDs that cannot be shown to this user right now:
 * per-day cap reached, still inside the cooldown, no budget left, or already
 * held by the client (so a lease is never wasted on a duplicate).
 */
export function filterSelectable<T extends SelectionCampaign>(
  campaigns: T[],
  history: Map<string, SelectionHistory>,
  now: number,
  today: string,
  excluded: ReadonlySet<string>,
): T[] {
  return campaigns.filter((campaign) => {
    if (excluded.has(campaign.id)) return false;
    if (remainingBudgetMicro(campaign, today) <= 0n) return false;
    const seen = history.get(campaign.id);
    if (!seen) return true;
    if (seen.views >= campaign.maxPerDayPerUser) return false;
    if (now - seen.lastShownAt < campaign.cooldownSec * 1_000) return false;
    return true;
  });
}

/**
 * Weight for one campaign. Bid is the dominant term; budget remaining protects
 * campaigns close to their daily cap, freshness rotates creatives across a
 * user's day, and the per-day allowance keeps a capped campaign from being
 * served again just before the client would reject it.
 */
export function campaignWeight(
  campaign: SelectionCampaign,
  history: Map<string, SelectionHistory>,
  today: string,
): number {
  const bid = Number(campaign.cpiMicro);
  if (bid <= 0) return 0;

  const budget = Number(campaign.dailyBudgetMicro);
  const left = Number(remainingBudgetMicro(campaign, today));
  const budgetFactor = budget > 0 ? Math.min(1, left / budget) : 0;

  const seen = history.get(campaign.id);
  const seenToday = seen?.views ?? 0;
  const freshness = 1 / (1 + seenToday);
  const allowance = Math.max(
    0.1,
    (campaign.maxPerDayPerUser - seenToday) / Math.max(1, campaign.maxPerDayPerUser),
  );

  return bid * (0.25 + 0.75 * budgetFactor) * freshness * allowance;
}

/**
 * Weighted sampling without replacement. Deterministic given `random`, which
 * makes it unit-testable; every returned item is unique.
 */
export function weightedSample<T>(
  items: T[],
  weightOf: (item: T) => number,
  count: number,
  random: () => number = Math.random,
): T[] {
  const pool = items.filter((item) => weightOf(item) > 0);
  const picked: T[] = [];
  const limit = Math.max(0, Math.min(count, pool.length));

  while (picked.length < limit) {
    let total = 0;
    const weights = pool.map((item) => {
      const weight = weightOf(item);
      total += weight;
      return weight;
    });
    if (total <= 0) break;

    let ticket = random() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      ticket -= weights[i] ?? 0;
      if (ticket < 0) {
        index = i;
        break;
      }
    }

    const chosen = pool[index];
    if (chosen === undefined) break;
    picked.push(chosen);
    pool.splice(index, 1);
  }

  return picked;
}
