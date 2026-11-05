/** Monetary amounts are stored as micro-dollars: $1.00 = 1_000_000. */
export const MICRO_DOLLARS_PER_USD = 1_000_000;

export const REVENUE_SHARE = {
  USER_BPS: 5_500,
  PLATFORM_BPS: 4_500,
} as const;

export const PAYOUT_THRESHOLD_USD = 5_000_000; // $5.00 in micro-dollars
export const WELCOME_BONUS_USD = 1_000_000; // $1.00
export const SOCIAL_TASK_REWARD_USD = 100_000; // $0.10

/**
 * Referral program. The bonus vests only after the referred user earns
 * REFERRAL_QUALIFY_EARNINGS_USD in *verified* ad views — an account that
 * signs up and never really uses the product pays nothing, which kills
 * bonus-farming economics.
 */
export const REFERRAL_BONUS_USD = 500_000; // $0.50 to the referrer
export const REFERRAL_QUALIFY_EARNINGS_USD = 1_000_000; // $1.00 verified
export const MAX_CAMPAIGN_VARIANTS = 3;

/** Cumulative active-viewport time required for an impression to be paid. Default 5s. */
export const MIN_VIEWABLE_MS = 5_000;

export const CAMPAIGN_DURATION = {
  MIN_SEC: 2,
  MAX_SEC: 15,
  DEFAULT_SEC: 5,
  /** Minimum bid per second of required view time (micro-dollars). $0.002/s = $0.010 for 5s. */
  MIN_CPI_MICRO_PER_SEC: 2_000,
} as const;

export function minCpiForDuration(durationSec: number): number {
  const clamped = Math.max(CAMPAIGN_DURATION.MIN_SEC, Math.min(CAMPAIGN_DURATION.MAX_SEC, durationSec));
  return clamped * CAMPAIGN_DURATION.MIN_CPI_MICRO_PER_SEC;
}
/** Fraction of the ad element that must be visible to accrue time. */
export const VIEWABILITY_THRESHOLD = 0.75;
/** A hover only counts as intentional after this much continuous hover time. */
export const HOVER_INTENT_MIN_MS = 500;
/**
 * Hard cap on how long a completed/streaming ad is held open while the pointer
 * rests on it. The user asked the ad not to vanish under their cursor; this
 * bounds that courtesy so a parked pointer cannot pin a lease forever.
 */
export const HOVER_HOLD_MAX_MS = 60_000;

/** Human labels for the two ad slots, shared by popup and docs. */
export const PLACEMENT_LABELS = {
  thinking_indicator: "In the thinking bubble",
  above_composer: "Above prompt box",
} as const;

/** Laya auto-moderation score bands (0–100). */
export const LAYA = {
  AUTO_APPROVE: 85,
  AUTO_REJECT: 40,
  /** Social tasks auto-approve only above this stricter band. */
  TASK_AUTO_APPROVE: 90,
} as const;

/** Geo targeting is expressed as coarse clusters, never raw location. */
export const GEO_CLUSTER_UNKNOWN = "XX-UNKNOWN";

export const EXTENSION_CACHE = {
  MAX_CACHED_ADS: 25,
  LOW_WATER_MARK: 5,
  PREFETCH_BATCH_SIZE: 15,
} as const;

export const TELEMETRY = {
  FLUSH_INTERVAL_MINUTES: 15,
  FLUSH_QUEUE_SIZE: 15,
  MAX_EVENTS_PER_BATCH: 50,
  /** Compression stats (algorithms can also declare their own ranges). */
  DEFLATE_FORMAT: "deflate",
} as const;

/** Pacing tiers for Layer-4 velocity dampening. */
export const PACING = {
  WINDOW_SECONDS: 3_600,
  TIER1_MAX_PER_HOUR: 12,
  TIER2_MAX_PER_HOUR: 25,
  /** In tier 2, one ad is shown every N prompts. */
  TIER2_PROMPT_DIVISOR: 3,
} as const;

/** Layer-3 cadence analysis thresholds. */
export const CADENCE = {
  /** Minimum prompts in a sliding window before CV is evaluated. */
  MIN_SAMPLE: 15,
  /** Batches with coefficient of variation below this are flagged. */
  CV_FLAG_THRESHOLD: 0.08,
  /** Humans typically sit well above this; informational. */
  CV_HUMAN_TYPICAL: 0.35,
  /** Impressions with viewable-ms in [5001, 5015]... */
  CLUSTER_MIN_MS: 5_001,
  CLUSTER_MAX_MS: 5_015,
  /** ...across this many consecutive impressions triggers a flag. */
  CLUSTER_STREAK: 50,
} as const;

/** Layer-5 composite trust score bands. */
export const TRUST = {
  AUTO_APPROVE: 80,
  MANUAL_REVIEW: 50,
} as const;

export const AD_COPY_LIMITS = {
  HEADLINE_MAX: 70,
  BODY_MAX: 140,
  CTA_MAX: 24,
} as const;

export const LEASE = {
  TTL_SECONDS: 43_200, // 12 hours
  CLOCK_SKEW_SECONDS: 120,
} as const;

export const SNOOZE_OPTIONS_MINUTES = [10, 15, 60] as const;

export const PLATFORM_IDS = [
  "openai",
  "gemini",
  "grok",
  "claude",
  "deepseek",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];
