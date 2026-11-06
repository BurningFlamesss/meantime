import { AD_COPY_LIMITS, PLATFORM_IDS } from "./constants.js";

export type DisplayMode = "wait_time_only" | "persist_until_5s";
/**
 * The two supported ad slots. `thinking_indicator` renders a full-width row in
 * the conversation flow where the assistant's "thinking" bubble appears, just
 * after the user's prompt. `above_composer` floats immediately above the
 * prompt box. Both are chosen by the user in the popup.
 */
export type Placement = "thinking_indicator" | "above_composer";
export type ThemePreference = "auto" | "light" | "dark";
export type PayoutMethod = "paypal" | "stripe_connect" | "wise" | "usdc" | "usdt";
export type TaskPlatform = "x" | "linkedin" | "reddit" | "chrome_web_store" | "other";
export type TaskStatus = "pending" | "approved" | "rejected";
export type PayoutStatus = "requested" | "auditing" | "approved" | "paid" | "rejected" | "frozen";
export type FraudSeverity = "info" | "warning" | "critical";
export type CloseReason =
  | "stream_started"
  | "earned"
  | "dismissed"
  | "snoozed"
  | "navigated"
  | "superseded";

export interface FrequencyCapMeta {
  maxPerDay: number;
  cooldownSec: number;
}

/** One prefetched ad as delivered by POST /ads/prefetch and cached in the extension. */
export interface PrefetchedAd {
  adId: string;
  campaignId: string;
  /** Which creative variant this is; null/undefined = base copy. */
  variantId?: string | null;
  variantLabel?: string;
  leaseId: string;
  /** Base64url payload || "." || base64url HMAC-SHA256 signature. */
  leaseToken: string;
  issuedAt: number;
  expiresAt: number;
  /**
   * Advertiser bid per verified view, micro-dollars, as a decimal string.
   * Postgres stores it as a bigint; JSON has no bigint type, so the wire
   * format is a string and the client never loses precision on large bids.
   * Server-authoritative.
   */
  cpiMicro: string;
  /** Required view duration in seconds (2s - 15s). Defaults to 5s. */
  durationSec?: number;
  headline: string;
  bodyText: string;
  ctaText: string;
  targetUrl: string;
  /** Campaign platform targets; empty = all platforms. The extension filters locally. */
  targetPlatforms: string[];
  frequencyCap: FrequencyCapMeta;
}

export interface LeaseTokenPayload {
  v: 1;
  lid: string; // lease id (UUIDv4)
  uid: string; // user id
  did: string; // device id
  aid: string; // ad id
  cid: string; // campaign id
  iat: number; // issued at, unix seconds
  exp: number; // expires at, unix seconds
  dur?: number; // duration seconds (2-15)
}

/** What the content script knows at trigger time — never includes prompt text. */
export interface PohiSignals {
  inputInteractionScore: number;
  keystrokeCount: number;
  trustedPasteSeen: boolean;
  aiMutationVerified: boolean;
}

export interface ImpressionEvent {
  impressionId: string;
  leaseToken: string;
  platform: string;
  placement: Placement;
  displayMode: DisplayMode;
  submittedAt: number;
  /** Wall-clock ms from prompt submission to first visible AI output. */
  aiWaitDurationMs: number;
  /** Cumulative active-viewport ms, capped by teardown. */
  cumulativeVisibleMs: number;
  /** Total ms of intentional hover (each contiguous hover >= 500ms). */
  hoverMs: number;
  /** True when at least one intentional hover occurred. */
  hoverIntentional: boolean;
  closedReason: CloseReason;
  earned: boolean;
  /** Required view duration in seconds (2-15) for this ad/impression. */
  durationSec?: number;
  pohi: PohiSignals;
  /** How many prompts this user sent in the trailing hour (for pacing audits). */
  promptsLastHour: number;
}

export interface TelemetryBatch {
  batchId: string;
  deviceId: string;
  extensionVersion: string;
  sentAt: number;
  events: ImpressionEvent[];
}

export interface TelemetryEventResult {
  impressionId: string;
  status: "verified" | "rejected" | "flagged";
  earnedMicro: number;
  reasons: string[];
}

export interface TelemetryBatchResponse {
  accepted: number;
  results: TelemetryEventResult[];
}

export interface PrefetchRequest {
  deviceId: string;
  count: number;
  platforms: string[];
  maxDurationSec?: number;
}

export interface PrefetchResponse {
  ads: PrefetchedAd[];
  /** Server-evaluated pacing state so the extension can pre-empt injection. */
  pacing: PacingState;
  serverTime: number;
}

export interface PacingState {
  tier: 1 | 2 | 3;
  /** Ads remaining this hour in the current tier. -1 when capped out. */
  remainingThisHour: number;
  promptDivisor: number;
}

export interface UserBalance {
  availableMicro: number;
  pendingMicro: number;
  lifetimeMicro: number;
  thresholdMicro: number;
  emailVerified?: boolean;
}

export interface VerifyEmailResponse {
  ok: boolean;
  message: string;
}

export interface TransparencyLogEntry {
  impressionId: string;
  viewedAt: number;
  platform: string;
  cumulativeVisibleMs: number;
  eligible: boolean;
  earnedMicro: number;
  campaignHeadline: string;
}

export interface CampaignInput {
  name: string;
  headline: string;
  bodyText: string;
  ctaText: string;
  targetUrl: string;
  dailyBudgetMicro: number;
  cpiMicro: number;
  durationSec?: number;
  targetPlatforms: string[];
  /** Geo clusters the campaign should serve in; empty = worldwide. */
  targetGeoClusters: string[];
}

export type ModerationDecision = "auto_approved" | "auto_rejected" | "needs_review";

export interface ModerationOutcome {
  score: number;
  decision: ModerationDecision;
  reasons: string[];
  /** Which checks ran — "policy", "reputation", "llm". */
  layers: string[];
}

export interface GeoClusterBreakdown {
  geoCluster: string;
  uniqueUsers: number;
  views: number;
  verifiedViews: number;
  intentionalHovers: number;
  /** Intentional hovers ÷ views for this cluster. Same denominator as CTR. */
  hoverRate: number;
  totalHoverMs: number;
  clicks: number;
  avgRetentionMs: number;
}

export interface CampaignAnalytics {
  campaignId: string;
  totals: {
    views: number;
    verifiedViews: number;
    uniqueUsers: number;
    intentionalHovers: number;
    /** Intentional hovers ÷ views: the share of impressions that drew a deliberate hover. */
    hoverRate: number;
    /** Total milliseconds users deliberately hovered over the ad (intent-gated). */
    totalHoverMs: number;
    /** Mean intentional hover per impression, in milliseconds. */
    avgHoverMs: number;
    clicks: number;
    ctr: number;
    avgRetentionMs: number;
    completionRate: number;
    spendMicro: number;
  };
  /** Aggregated per geo cluster. IPs are never stored or returned. */
  geo: GeoClusterBreakdown[];
}

export interface CampaignStats {
  campaignId: string;
  impressions: number;
  verifiedViews: number;
  completionRate: number;
  clicks: number;
  ctr: number;
  spendMicro: number;
  avgVisibleMs: number;
}

export interface TaskSubmission {
  taskType: TaskPlatform;
  postUrl: string;
  screenshotKey: string;
}

export interface TrustScoreBreakdown {
  total: number;
  accountAgeScore: number;
  networkScore: number;
  payoutUniquenessScore: number;
  interactionScore: number;
  cadenceScore: number;
}

export const COPY_LIMITS = AD_COPY_LIMITS;
export const KNOWN_PLATFORMS = PLATFORM_IDS;
