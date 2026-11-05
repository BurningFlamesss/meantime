import type { PrefetchedAd } from "@meantime/shared";
import { EXTENSION_CACHE } from "@meantime/shared";
import {
  STORAGE_KEYS,
  storageGet,
  storageSet,
  type ImpressionHistory,
} from "./storage";

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * All mutations of the ad cache go through one promise chain inside the
 * service worker. Without it, two tabs asking for an ad at the same time can
 * read the same cache and both take the same lease.
 */
let cacheChain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = cacheChain.then(fn, fn);
  cacheChain = run.catch(() => undefined);
  return run;
}

/**
 * Keep only live, well-formed, unique leases. Storage can survive a version
 * change or a partial write, and expired leases used to keep the cache looking
 * full (so the low-water prefetch never fired). Deduplicating by leaseId also
 * stops a requeued ad from being handed to two tabs.
 */
export function normalizeCachedAds(pool: PrefetchedAd[], now = Date.now()): PrefetchedAd[] {
  const seen = new Set<string>();
  const live: PrefetchedAd[] = [];
  for (const ad of pool) {
    if (!ad || typeof ad !== "object") continue;
    if (typeof ad.leaseId !== "string" || ad.leaseId.length === 0) continue;
    if (typeof ad.leaseToken !== "string" || ad.leaseToken.length === 0) continue;
    if (typeof ad.campaignId !== "string" || ad.campaignId.length === 0) continue;
    if (typeof ad.headline !== "string" || ad.headline.trim().length === 0) continue;
    if (typeof ad.ctaText !== "string" || ad.ctaText.trim().length === 0) continue;
    if (typeof ad.targetUrl !== "string") continue;
    if (!ad.frequencyCap || typeof ad.frequencyCap.maxPerDay !== "number") continue;
    if (typeof ad.expiresAt !== "number" || ad.expiresAt * 1000 <= now) continue;
    if (seen.has(ad.leaseId)) continue;
    seen.add(ad.leaseId);
    live.push(ad);
  }
  // Ring buffer: keep the newest MAX_CACHED_ADS entries.
  return live.slice(-EXTENSION_CACHE.MAX_CACHED_ADS);
}

export async function getCachedAds(now = Date.now()): Promise<PrefetchedAd[]> {
  const raw = await storageGet<PrefetchedAd[]>(STORAGE_KEYS.AD_CACHE, []);
  return normalizeCachedAds(Array.isArray(raw) ? raw : [], now);
}

export async function setCachedAds(ads: PrefetchedAd[]): Promise<void> {
  await storageSet(STORAGE_KEYS.AD_CACHE, normalizeCachedAds(ads));
}

/**
 * Merge a prefetch response into the cache inside the same serial chain as
 * takeAd/requeueAd. Re-reading the pool here is what prevents a request that
 * started before a tab consumed a lease from putting that lease back.
 */
export function mergeCachedAds(fresh: PrefetchedAd[]): Promise<void> {
  return serial(async () => {
    const pool = await getCachedAds();
    const known = new Set(pool.map((a) => a.leaseId));
    const additions = normalizeCachedAds(fresh).filter((a) => !known.has(a.leaseId));
    if (additions.length === 0) return;
    await storageSet(STORAGE_KEYS.AD_CACHE, normalizeCachedAds([...pool, ...additions]));
  });
}

export async function cacheSize(): Promise<number> {
  return (await getCachedAds()).length;
}

export async function getHistory(): Promise<ImpressionHistory> {
  return storageGet<ImpressionHistory>(STORAGE_KEYS.IMPRESSION_HISTORY, {});
}

function supportsPlatform(ad: PrefetchedAd, platform?: string): boolean {
  if (!platform) return true;
  const targets = ad.targetPlatforms ?? [];
  return targets.length === 0 || targets.includes(platform);
}

/**
 * Local deduplication engine — pure, synchronous, zero network. Removes ads
 * whose lease expired, whose per-day cap is reached, whose campaign is still
 * in cooldown, or that target a different AI platform.
 */
export function filterEligible(
  pool: PrefetchedAd[],
  history: ImpressionHistory,
  now: number,
  platform?: string,
  maxDurationSec?: number,
): PrefetchedAd[] {
  const today = dayKey(now);
  const seenLeases = new Set<string>();
  return pool.filter((ad) => {
    if (ad.expiresAt * 1000 <= now) return false;
    if (seenLeases.has(ad.leaseId)) return false;
    seenLeases.add(ad.leaseId);
    if (!supportsPlatform(ad, platform)) return false;
    if (maxDurationSec !== undefined && (ad.durationSec ?? 5) > maxDurationSec) return false;
    const rec = history[ad.campaignId];
    if (!rec) return true;
    const viewsToday = rec.days.filter((d) => d === today).length;
    if (viewsToday >= ad.frequencyCap.maxPerDay) return false;
    if (now - rec.lastShownAt < ad.frequencyCap.cooldownSec * 1000) return false;
    return true;
  });
}

function pruneHistory(history: ImpressionHistory, now: number): ImpressionHistory {
  const cutoff = dayKey(now - 7 * 86_400_000);
  for (const [campaignId, rec] of Object.entries(history)) {
    rec.days = rec.days.filter((d) => d >= cutoff).slice(-7);
    if (rec.days.length === 0 && rec.lastShownAt < now - 7 * 86_400_000) delete history[campaignId];
  }
  return history;
}

/**
 * Pop the next eligible ad out of the cache and record it in the local
 * impression history. Returns null when nothing qualifies.
 */
export function takeAd(
  now = Date.now(),
  platform?: string,
  maxDurationSec?: number,
): Promise<PrefetchedAd | null> {
  return serial(async () => {
    const [pool, storedHistory] = await Promise.all([getCachedAds(), getHistory()]);
    const history = pruneHistory(storedHistory, now);
    const eligible = filterEligible(pool, history, now, platform, maxDurationSec);
    const chosen = eligible[0];
    if (!chosen) return null;

    const remaining = pool.filter((a) => a.leaseId !== chosen.leaseId);
    await setCachedAds(remaining);

    const rec = history[chosen.campaignId] ?? { days: [], lastShownAt: 0 };
    rec.days.push(dayKey(now));
    rec.days = rec.days.slice(-7);
    rec.lastShownAt = now;
    history[chosen.campaignId] = rec;
    await storageSet(STORAGE_KEYS.IMPRESSION_HISTORY, history);

    return chosen;
  });
}

/** Return an ad whose widget failed to mount so its lease is not wasted. */
export function requeueAd(ad: PrefetchedAd): Promise<void> {
  return serial(async () => {
    if (ad.expiresAt * 1000 <= Date.now()) return;
    const pool = await getCachedAds();
    if (pool.some((a) => a.leaseId === ad.leaseId)) return;
    // Append, not prepend: setCachedAds keeps the newest entries at the tail,
    // so a requeued lease would otherwise be dropped when the cache is full.
    await setCachedAds([...pool, ad]);
  });
}
