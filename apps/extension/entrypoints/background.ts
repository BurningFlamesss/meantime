import {
  EXTENSION_CACHE,
  TELEMETRY,
  type PrefetchedAd,
  type PrefetchResponse,
  type TelemetryBatchResponse,
} from "@meantime/shared";
import { cacheSize, getCachedAds, mergeCachedAds, requeueAd, takeAd } from "../lib/ad-cache";
import { ApiError, apiFetch } from "../lib/api-client";
import {
  ackBatch,
  buildBatch,
  peekBatch,
  pendingCount,
  queueImpression,
  type QueuedImpression,
} from "../lib/telemetry-queue";
import {
  DEFAULT_AD_REQUEST_LIMIT,
  getSettings,
  PAUSE_UNTIL_RESTART,
  saveSettings,
  STORAGE_KEYS,
  storageGet,
  storageSet,
  type AdRequestLimit,
  type Identity,
  type PromptCounter,
} from "../lib/storage";

const FLUSH_ALARM = "meantime:telemetry-flush";
const FLUSH_LOCK_KEY = "telemetry_flush_lock";
const PREFETCH_LOCK_KEY = "prefetch_lock";
const LAST_PLATFORM_KEY = "last_platform";
const LOCK_TTL_MS = 120_000;
const EXTENSION_VERSION = "0.1.0";

export default defineBackground(() => {
  const sw = new MeanTimeBackground();
  sw.start();
});

class MeanTimeBackground {
  private flushInFlight: Promise<void> | null = null;

  start(): void {
    chrome.alarms.create(FLUSH_ALARM, {
      periodInMinutes: TELEMETRY.FLUSH_INTERVAL_MINUTES,
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === FLUSH_ALARM) void this.flushTelemetry();
    });

    chrome.idle.onStateChanged.addListener((state) => {
      if (state === "idle") void this.prefetchIfNeeded();
    });

    chrome.runtime.onInstalled.addListener(() => void this.handleBrowserStart());
    chrome.runtime.onStartup.addListener(() => void this.handleBrowserStart());

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      void this.handleMessage(msg)
        .then(sendResponse)
        .catch(() => sendResponse(null));
      return true; // async response
    });
  }

  private async handleMessage(msg: {
    type: string;
    event?: Parameters<typeof queueImpression>[0];
    ad?: PrefetchedAd;
    impressionId?: string;
    leaseToken?: string;
    platform?: string;
  }): Promise<unknown> {
    switch (msg.type) {
      case "take_ad": {
        // Signed-out installs must not show cached ads.
        const identity = await storageGet<Identity | null>(STORAGE_KEYS.IDENTITY, null);
        if (!identity) return null;
        if (msg.platform) await storageSet(LAST_PLATFORM_KEY, msg.platform);
        const settings = await getSettings();
        let ad = await takeAd(Date.now(), msg.platform, settings.maxAdDurationSec);
        if (!ad) {
          await this.prefetchForPlatform(msg.platform, settings.maxAdDurationSec, identity);
          ad = await takeAd(Date.now(), msg.platform, settings.maxAdDurationSec);
        } else {
          void this.prefetchIfNeeded(false);
        }
        return ad;
      }
      case "return_ad":
        if (msg.ad) await requeueAd(msg.ad);
        return null;
      case "queue_impression": {
        if (!msg.event) return null;
        const counter = await storageGet<PromptCounter>(STORAGE_KEYS.PROMPT_COUNTER, {
          windowStart: Date.now(),
          count: 0,
        });
        msg.event.promptsLastHour = counter.count;
        const size = await queueImpression(msg.event);
        if (size >= TELEMETRY.FLUSH_QUEUE_SIZE) void this.flushTelemetry();
        return { queued: size };
      }
      case "ad_click":
        if (msg.impressionId && msg.leaseToken) {
          void apiFetch("/ads/click", {
            method: "POST",
            json: { impressionId: msg.impressionId, leaseToken: msg.leaseToken },
          }).catch(() => undefined);
        }
        return null;
      case "flush_now":
        await this.flushTelemetry();
        return null;
      case "prefetch_now":
        await this.prefetchIfNeeded(true);
        return null;
      case "cache_status":
        return { size: await cacheSize(), pending: await pendingCount() };
      default:
        return null;
    }
  }

  /**
   * A pause set to "until browser restart" is cleared when the browser starts
   * again. The sentinel lives in local storage (content scripts and the popup
   * both read it), so the service worker is the one place that retires it.
   */
  private async handleBrowserStart(): Promise<void> {
    const settings = await getSettings();
    if (settings.snoozedUntil === PAUSE_UNTIL_RESTART) {
      await saveSettings({ snoozedUntil: 0 });
    }
    await this.prefetchIfNeeded(true);
  }

  /* ------------------------------ prefetching ---------------------------- */

  private async prefetchForPlatform(
    platform: string | undefined,
    maxDurationSec: number,
    identity: Identity,
  ): Promise<void> {
    // A 429 already told us when to try again; do not hammer the endpoint on
    // every prompt while the cache is empty.
    if (await this.prefetchCooldownActive()) return;
    try {
      const pool = await getCachedAds();
      const res = await apiFetch<PrefetchResponse>("/ads/prefetch", {
        method: "POST",
        json: {
          deviceId: identity.deviceId,
          count: EXTENSION_CACHE.PREFETCH_BATCH_SIZE,
          platforms: platform ? [platform] : [],
          maxDurationSec,
          excludeCampaignIds: [...new Set(pool.map((a) => a.campaignId))],
        },
      });
      await mergeCachedAds(res.ads);
      await storageSet(STORAGE_KEYS.PACING_STATE, { ...res.pacing, updatedAt: Date.now() });
      await this.clearPrefetchLimit();
    } catch (error) {
      // API down or rate-limited — keep serving the existing cache.
      await this.recordPrefetchLimit(error);
    }
  }

  private async prefetchIfNeeded(force = false): Promise<void> {
    const identity = await storageGet<Identity | null>(STORAGE_KEYS.IDENTITY, null);
    if (!identity) return;

    if (!force && (await this.prefetchCooldownActive())) return;

    const size = await cacheSize();
    if (!force && size >= EXTENSION_CACHE.LOW_WATER_MARK) return;

    if (!(await this.acquireLock(PREFETCH_LOCK_KEY, 30_000))) return;

    try {
      const settings = await getSettings();
      const lastPlatform = await storageGet<string | null>(LAST_PLATFORM_KEY, null);
      const count = EXTENSION_CACHE.PREFETCH_BATCH_SIZE;
      const pool = await getCachedAds();
      const res = await apiFetch<PrefetchResponse>("/ads/prefetch", {
        method: "POST",
        json: {
          deviceId: identity.deviceId,
          count,
          platforms: lastPlatform ? [lastPlatform] : [],
          maxDurationSec: settings.maxAdDurationSec,
          excludeCampaignIds: [...new Set(pool.map((a) => a.campaignId))],
        },
      });
      await mergeCachedAds(res.ads);
      await storageSet(STORAGE_KEYS.PACING_STATE, { ...res.pacing, updatedAt: Date.now() });
      await this.clearPrefetchLimit();
    } catch (error) {
      // Offline, API down, or rate-limited — keep serving the existing cache.
      await this.recordPrefetchLimit(error);
    } finally {
      await this.releaseLock(PREFETCH_LOCK_KEY);
    }
  }

  private async prefetchCooldownActive(): Promise<boolean> {
    const limit = await storageGet<AdRequestLimit>(
      STORAGE_KEYS.AD_REQUEST_LIMIT,
      DEFAULT_AD_REQUEST_LIMIT,
    );
    return limit.limitedUntil > Date.now();
  }

  private async recordPrefetchLimit(error: unknown): Promise<void> {
    if (!(error instanceof ApiError) || error.status !== 429) return;
    const retryAfterSec = Math.max(1, Math.ceil(error.retryAfterSec || 60));
    const now = Date.now();
    await storageSet(STORAGE_KEYS.AD_REQUEST_LIMIT, {
      limitedUntil: now + retryAfterSec * 1_000,
      retryAfterSec,
      scope: "prefetch",
      updatedAt: now,
    });
  }

  private async clearPrefetchLimit(): Promise<void> {
    await storageSet(STORAGE_KEYS.AD_REQUEST_LIMIT, {
      ...DEFAULT_AD_REQUEST_LIMIT,
      updatedAt: Date.now(),
    });
  }

  /* ------------------------------- telemetry ----------------------------- */

  /**
   * Batched flushes are serialized in-process and guarded by a short persisted
   * lock, so an alarm and a queue-size trigger cannot send the same batch
   * twice. Events are acknowledged only after the server accepts them.
   */
  private async flushTelemetry(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = this.doFlush().finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  private async doFlush(): Promise<void> {
    if (!(await this.acquireLock(FLUSH_LOCK_KEY, LOCK_TTL_MS))) return;

    try {
      if ((await pendingCount()) === 0) return;
      const identity = await storageGet<Identity | null>(STORAGE_KEYS.IDENTITY, null);
      if (!identity) return;

      // A wake flushes at most four batches; the rest wait for the next alarm
      // so a large backlog cannot keep the service worker alive indefinitely.
      for (let i = 0; i < 4; i++) {
        const events: QueuedImpression[] = await peekBatch(TELEMETRY.MAX_EVENTS_PER_BATCH);
        if (events.length === 0) return;

        const batch = buildBatch(events, identity.deviceId, EXTENSION_VERSION);
        try {
          await apiFetch<TelemetryBatchResponse>("/telemetry/batch", {
            method: "POST",
            json: batch,
            compress: true,
          });
          await ackBatch(events.map((event) => event.impressionId));
        } catch (error) {
          // A 4xx that is not a transient limit means this batch can never
          // succeed (malformed/expired payload). Drop it instead of blocking
          // the queue forever; keep network errors and 5xx for retry.
          const status = error instanceof ApiError ? error.status : 0;
          const poison = status >= 400 && status < 500 && status !== 408 && status !== 429;
          if (poison) {
            await ackBatch(events.map((event) => event.impressionId));
            continue;
          }
          return;
        }
      }
    } finally {
      await this.releaseLock(FLUSH_LOCK_KEY);
    }
  }

  private async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const current = await chrome.storage.local.get(key);
    const stamp = current[key];
    if (typeof stamp === "number" && Date.now() - stamp < ttlMs) return false;
    await chrome.storage.local.set({ [key]: Date.now() });
    return true;
  }

  private async releaseLock(key: string): Promise<void> {
    await chrome.storage.local.set({ [key]: 0 });
  }
}

