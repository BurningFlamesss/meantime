// Clean implementation of ad cache with rotate-without-replacement strategy

import type { PrefetchedAd } from "@meantime/shared";
import { EXTENSION_CACHE } from "@meantime/shared";
import {
  storageGet,
  storageSet,
  type ImpressionHistory,
} from "./storage"
import { STORAGE_KEYS } from "./storage";

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

/**
 * Pop the next eligible ad out of the cache and record it in the local
 * impression history. Returns null when nothing qualifies.
 *
 * Selection is deterministic: among eligible ads the least-recently served is
 * chosen (rotation without replacement). This keeps the same ad from being
 * served back-to-back across prompts while still burning a lease that was
 * taken from the cache.
 */
export function takeAd(
  now = Date.now(),
  platform?: string,
  maxDurationSec?: number,
): Promise<PrefetchedAd | null> {
  return serial(async () => {
    const [pool, storedHistory] = await Promise.all([getCachedAds(now), getHistory()]);
    const serveHistory = await storageGet<Record<string, { servedAt: number }>>(STORAGE_KEYS.AD_SERVE_HISTORY, {});
    const history = pruneHistory(storedHistory, now);
    const eligible = filterEligible(pool, history, now, platform, maxDurationSec);
    if (eligible.length === 0) return null;
    // Rotate without replacement: pick the least-recently served eligible ad.
    eligible.sort((a, b) => {
      const aTime = serveHistory[a.leaseId]?.servedAt ?? 0;
      const bTime = serveHistory[b.leaseId]?.servedAt ?? 0;
      return aTime - bTime;
    });
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

    await storageSet(STORAGE_KEYS.AD_SERVE_HISTORY, {
      ...serveHistory,
      [chosen.leaseId]: { servedAt: now },
    });
    await pruneAdServeHistory(now);
    return chosen;
  });
}

/** Alias kept for callers that name the rotation explicitly. */
export const takeAdRotated = takeAd;

/**
 * Return the number of live ads in the cache.
 */
export async function cacheSize(now = Date.now()): Promise<number> {
  const ads = await getCachedAds(now);
  return ads.length;
}

/**
 * Add new ads to the cache, deduplicating by leaseId and preserving local
 * serve history.
 */
export function mergeCachedAds(incoming: PrefetchedAd[]): Promise<void> {
  return serial(async () => {
    const pool = await getCachedAds();
    const existingIds = new Set(pool.map((a) => a.leaseId));
    const unique = incoming.filter((a) => !existingIds.has(a.leaseId));
    if (unique.length === 0) return;
    await setCachedAds([...pool, ...unique]);
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

/**
 * Record that we served an ad, for rotation history.
 * Uses the same serial chain to avoid concurrent writes.
 */
export function recordAdServe(
  campaignId: string,
  leaseId: string,
  now = Date.now(),
): Promise<void> {
  return serial(async () => {
    const key = STORAGE_KEYS.AD_SERVE_HISTORY;
    const stored = await storageGet<Record<string, { servedAt: number }>>(key, {});
    stored[leaseId] = { servedAt: now };
    await storageSet(key, stored);
  });
}

/** Remove entries older than the TTL (30 minutes) for cleanup. */
export function pruneAdServeHistory(now = Date.now()): Promise<void> {
  const cutoff = now - 30 * 60 * 1000; // 30 min
  return serial(async () => {
    const key = STORAGE_KEYS.AD_SERVE_HISTORY;
    const stored = await storageGet<Record<string, { servedAt: number }>>(key, {});
    const filtered: Record<string, { servedAt: number }> = {};
    for (const [leaseId, val] of Object.entries(stored)) {
      if (val.servedAt >= cutoff) filtered[leaseId] = val;
    }
    await storageSet(key, filtered);
  });
}

export async function getCachedAds(now = Date.now()): Promise<PrefetchedAd[]> {
  const raw = await storageGet<PrefetchedAd[]>(STORAGE_KEYS.AD_CACHE, []);
  return normalizeCachedAds(Array.isArray(raw) ? raw : [], now);
}

export async function setCachedAds(ads: PrefetchedAd[]): Promise<void> {
  await storageSet(STORAGE_KEYS.AD_CACHE, normalizeCachedAds(ads));
}

export async function getHistory(): Promise<ImpressionHistory> {
  return storageGet<ImpressionHistory>(STORAGE_KEYS.IMPRESSION_HISTORY, {});
}

function pruneHistory(history: ImpressionHistory, now: number): ImpressionHistory {
  const cutoff = dayKey(now - 7 * 86_400_000);
  for (const [campaignId, rec] of Object.entries(history)) {
    rec.days = rec.days.filter((d) => d >= cutoff).slice(-7);
    if (rec.days.length === 0 && rec.lastShownAt < now - 7 * 86_400_000) delete history[campaignId];
  }
  return history;
}