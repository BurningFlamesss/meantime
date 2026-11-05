import type { DisplayMode, PacingState, Placement, ThemePreference } from "@meantime/shared";

/** Keys used in chrome.storage.local. */
export const STORAGE_KEYS = {
  AD_CACHE: "ad_cache",
  IMPRESSION_HISTORY: "impression_history",
  PENDING_TELEMETRY: "pending_telemetry",
  SETTINGS: "settings",
  IDENTITY: "identity",
  POHI_SNAPSHOT: "pohi_snapshot",
  PROMPT_COUNTER: "prompt_counter",
  /** Mounted ads in the current hour; this is the ad-only pacing counter. */
  AD_COUNTER: "ad_counter",
  FIRST_RUN_SEEN: "first_run_seen",
  /** Latest server pacing snapshot, timestamped for staleness checks. */
  PACING_STATE: "pacing_state",
  /** Server-side prefetch (429) cooldown so every prompt does not retry. */
  AD_REQUEST_LIMIT: "ad_request_limit",
  /** Serve-history rotation: which ads we've served and when, for deterministic rotation */
  AD_SERVE_HISTORY: "ad_serve_history",
} as const;

export interface ExtensionSettings {
  displayMode: DisplayMode;
  placement: Placement;
  theme: ThemePreference;
  maxAdDurationSec: number;
  /** Epoch ms until which all injection is paused; 0 = not paused. */
  snoozedUntil: number;
  enabled: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  displayMode: "persist_until_5s",
  placement: "thinking_indicator",
  theme: "auto",
  maxAdDurationSec: 15,
  snoozedUntil: 0,
  enabled: true,
};

/**
 * Placements used to have four values. Saved settings from that build still
 * carry `under_prompt` / `ai_footer`, which no longer mount, so map them onto
 * the nearest surviving slot instead of silently showing nothing.
 */
export function normalizePlacement(value: unknown): Placement {
  if (value === "above_composer") return "above_composer";
  if (value === "thinking_indicator") return "thinking_indicator";
  return DEFAULT_SETTINGS.placement;
}

function normalizeSettings(settings: ExtensionSettings): ExtensionSettings {
  return { ...settings, placement: normalizePlacement(settings.placement) };
}

/** `snoozedUntil` value meaning "paused until the user turns ads back on". */
export const PAUSE_INDEFINITE = Number.MAX_SAFE_INTEGER;

/**
 * `snoozedUntil` value meaning "paused until the browser restarts". The
 * service worker clears it on startup; unlike the epoch form it survives tab
 * reloads and navigation, which is what a "not right now" pause should do.
 */
export const PAUSE_UNTIL_RESTART = -2;

export interface PauseState {
  paused: boolean;
  /** True when the pause has no scheduled end. */
  indefinite: boolean;
  /** True when the pause lifts on the next browser restart. */
  untilRestart: boolean;
  /** Epoch ms the pause lifts; 0 when not paused or paused indefinitely. */
  resumesAt: number;
}

/**
 * One reading of the pause state for the content script and the popup, so a
 * snooze started from the in-page widget shows up in the popup too.
 * `PAUSE_UNTIL_RESTART` is distinct from the legacy negative values, which
 * still mean indefinite.
 */
export function pauseState(settings: ExtensionSettings, now = Date.now()): PauseState {
  if (!settings.enabled) {
    return { paused: true, indefinite: true, untilRestart: false, resumesAt: 0 };
  }
  if (settings.snoozedUntil === PAUSE_UNTIL_RESTART) {
    return { paused: true, indefinite: false, untilRestart: true, resumesAt: 0 };
  }
  if (settings.snoozedUntil < 0 || settings.snoozedUntil >= PAUSE_INDEFINITE) {
    return { paused: true, indefinite: true, untilRestart: false, resumesAt: 0 };
  }
  if (settings.snoozedUntil > now) {
    return {
      paused: true,
      indefinite: false,
      untilRestart: false,
      resumesAt: settings.snoozedUntil,
    };
  }
  return { paused: false, indefinite: false, untilRestart: false, resumesAt: 0 };
}

export interface Identity {
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  /** Display only; auth truth is the server. */
  email?: string;
}

/** Per-campaign local view record used by the dedup engine. */
export interface ImpressionHistoryEntry {
  /** Day keys (YYYY-MM-DD) on which this campaign was shown. */
  days: string[];
  /** Epoch ms of last show, for cooldown enforcement. */
  lastShownAt: number;
}

export type ImpressionHistory = Record<string, ImpressionHistoryEntry>;

export interface PromptCounter {
  windowStart: number;
  count: number;
}

export type PacingSnapshot = PacingState & { updatedAt: number };

/** Persistent cooldown recorded when the ad endpoint answers 429. */
export interface AdRequestLimit {
  limitedUntil: number;
  retryAfterSec: number;
  scope: string;
  updatedAt: number;
}

export const DEFAULT_AD_REQUEST_LIMIT: AdRequestLimit = {
  limitedUntil: 0,
  retryAfterSec: 0,
  scope: "prefetch",
  updatedAt: 0,
};

export async function storageGet<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

let cachedSettings: ExtensionSettings = DEFAULT_SETTINGS;

if (typeof chrome !== "undefined" && chrome.storage?.local) {
  void storageGet(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS).then((s) => {
    cachedSettings = normalizeSettings(s);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[STORAGE_KEYS.SETTINGS];
    if (area === "local" && change?.newValue) {
      cachedSettings = normalizeSettings(change.newValue as ExtensionSettings);
    }
  });
}

export function getCachedSettings(): ExtensionSettings {
  return cachedSettings;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await storageGet(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  const current = normalizeSettings(stored);
  if (current.placement !== stored.placement) {
    await storageSet(STORAGE_KEYS.SETTINGS, current);
  }
  cachedSettings = current;
  return current;
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<void> {
  const current = await getSettings();
  await storageSet(STORAGE_KEYS.SETTINGS, { ...current, ...patch });
}

export function uuidv4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}
