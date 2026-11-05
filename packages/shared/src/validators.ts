import { z } from "zod";
import {
  AD_COPY_LIMITS,
  CAMPAIGN_DURATION,
  PLATFORM_IDS,
  PROOF_CONTENT_TYPES,
  TELEMETRY,
} from "./constants.js";

export const platformIdSchema = z.enum(PLATFORM_IDS);

export const pohiSignalsSchema = z.object({
  inputInteractionScore: z.number().min(0).max(1),
  keystrokeCount: z.number().int().min(0).max(10_000),
  trustedPasteSeen: z.boolean(),
  aiMutationVerified: z.boolean(),
});

export const impressionEventSchema = z.object({
  impressionId: z.string().uuid(),
  leaseToken: z.string().min(16).max(2048),
  platform: z.string().min(1).max(32),
  placement: z.enum(["thinking_indicator", "above_composer"]),
  displayMode: z.enum(["wait_time_only", "persist_until_5s"]),
  submittedAt: z.number().int().positive(),
  aiWaitDurationMs: z.number().min(0).max(600_000),
  cumulativeVisibleMs: z.number().min(0).max(600_000),
  hoverMs: z.number().min(0).max(600_000).default(0),
  hoverIntentional: z.boolean().default(false),
  closedReason: z.enum([
    "stream_started",
    "earned",
    "dismissed",
    "snoozed",
    "navigated",
    "superseded",
  ]),
  earned: z.boolean(),
  durationSec: z.number().int().min(CAMPAIGN_DURATION.MIN_SEC).max(CAMPAIGN_DURATION.MAX_SEC).optional(),
  pohi: pohiSignalsSchema,
  promptsLastHour: z.number().int().min(0).max(100_000),
});

export const telemetryBatchSchema = z.object({
  batchId: z.string().uuid(),
  deviceId: z.string().min(8).max(128),
  extensionVersion: z.string().max(32),
  sentAt: z.number().int().positive(),
  events: z.array(impressionEventSchema).min(1).max(TELEMETRY.MAX_EVENTS_PER_BATCH),
});

export const prefetchRequestSchema = z.object({
  deviceId: z.string().min(8).max(128),
  count: z.number().int().min(1).max(25),
  platforms: z.array(z.string().max(32)).max(8).default([]),
  maxDurationSec: z.number().int().min(CAMPAIGN_DURATION.MIN_SEC).max(CAMPAIGN_DURATION.MAX_SEC).optional(),
  /** Campaigns the client already holds, so a batch never wastes leases on duplicates. */
  excludeCampaignIds: z.array(z.string().uuid()).max(50).default([]),
});

/**
 * Ads and task proofs must point at a normal web page. Zod's `.url()` accepts
 * any scheme (`javascript:`, `data:`, `file:`), which would let a campaign send
 * the extension or a reviewer somewhere dangerous, so the scheme is pinned.
 */
export const httpUrlSchema = z
  .string()
  .max(512)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), { message: "must_be_http_url" });

export const taskUrlSchema = z
  .string()
  .max(1024)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), { message: "must_be_http_url" });

export const campaignInputSchema = z.object({
  name: z.string().min(2).max(80),
  headline: z.string().min(4).max(AD_COPY_LIMITS.HEADLINE_MAX),
  bodyText: z.string().min(10).max(AD_COPY_LIMITS.BODY_MAX),
  ctaText: z.string().min(2).max(AD_COPY_LIMITS.CTA_MAX),
  targetUrl: httpUrlSchema,
  dailyBudgetMicro: z.number().int().positive().max(1_000_000_000_000),
  cpiMicro: z.number().int().positive().max(100_000_000),
  durationSec: z.number().int().min(CAMPAIGN_DURATION.MIN_SEC).max(CAMPAIGN_DURATION.MAX_SEC).default(CAMPAIGN_DURATION.DEFAULT_SEC),
  targetPlatforms: z.array(z.string().max(32)).min(1).max(8),
  targetGeoClusters: z.array(z.string().max(16)).max(32).default([]),
  maxPerDayPerUser: z.number().int().min(1).max(20).default(3),
  cooldownSec: z.number().int().min(0).max(86_400).default(1800),
});

export const userSettingsUpdateSchema = z.object({
  maxAdDurationSec: z.number().int().min(CAMPAIGN_DURATION.MIN_SEC).max(CAMPAIGN_DURATION.MAX_SEC).optional(),
});

export const registerUserSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  displayName: z.string().min(1).max(60).optional(),
  referralCode: z.string().min(4).max(32).optional(),
  deviceId: z.string().min(8).max(128).optional(),
  fingerprintHash: z.string().min(8).max(128).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
  deviceId: z.string().min(8).max(128).optional(),
  fingerprintHash: z.string().min(8).max(128).optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(16).max(256),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(16).max(128),
});

export const resendVerificationSchema = z.object({
  email: z.string().email().max(254).optional(),
});

export const advertiserRegisterSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  companyName: z.string().min(1).max(80),
  website: httpUrlSchema.optional(),
});

export const advertiserLoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export const taskSubmissionSchema = z.object({
  taskType: z.enum(["x", "linkedin", "reddit", "chrome_web_store", "other"]),
  postUrl: taskUrlSchema,
  /** Object key returned by /tasks/presign; must live under the user's prefix. */
  screenshotKey: z
    .string()
    .min(24)
    .max(256)
    .regex(/^task-proofs\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i, "invalid_screenshot_key"),
});

/**
 * Request body for POST /tasks/presign. The content type is pinned to the
 * exact set /tasks/submit later verifies on the uploaded object, so a client
 * can never mint a presigned URL for an arbitrary content type.
 */
export const taskPresignSchema = z.object({
  contentType: z.enum(PROOF_CONTENT_TYPES),
});

export const payoutRequestSchema = z.object({
  method: z.enum(["paypal", "stripe_connect", "wise", "usdc", "usdt"]),
  address: z.string().min(4).max(256),
  // Bounded to keep every amount well inside Number.MAX_SAFE_INTEGER.
  amountMicro: z.number().int().positive().max(1_000_000_000_000),
});

export const clickEventSchema = z.object({
  impressionId: z.string().uuid(),
  leaseToken: z.string().min(16).max(2048),
});

export type TelemetryBatchInput = z.infer<typeof telemetryBatchSchema>;
export type ImpressionEventInput = z.infer<typeof impressionEventSchema>;
export type PrefetchRequestInput = z.infer<typeof prefetchRequestSchema>;
export type CampaignInputSchema = z.infer<typeof campaignInputSchema>;
