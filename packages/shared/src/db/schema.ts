import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* ---------------------------------- enums --------------------------------- */

export const taskPlatformEnum = pgEnum("task_platform", [
  "x",
  "linkedin",
  "reddit",
  "chrome_web_store",
  "other",
]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "approved", "rejected"]);
export const payoutMethodEnum = pgEnum("payout_method", [
  "paypal",
  "stripe_connect",
  "wise",
  "usdc",
  "usdt",
]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "requested",
  "auditing",
  "approved",
  "paid",
  "rejected",
  "frozen",
]);
export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "exhausted",
  "rejected",
]);
export const moderationDecisionEnum = pgEnum("moderation_decision", [
  "auto_approved",
  "auto_rejected",
  "needs_review",
]);
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "welcome_bonus",
  "ad_revenue_share",
  "social_task_reward",
  "referral_bonus",
  "advertiser_deposit",
  "advertiser_spend",
  "payout_debit",
  "adjustment",
]);
export const referralStatusEnum = pgEnum("referral_status", [
  "pending",
  "qualified",
  "paid",
  "void",
]);
export const fraudSeverityEnum = pgEnum("fraud_severity", ["info", "warning", "critical"]);
export const impressionStatusEnum = pgEnum("impression_status", [
  "verified",
  "rejected",
  "flagged",
]);

/* --------------------------------- tables --------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    country: text("country"),
    /** Salted SHA-256 of the signup IP for equality checks; raw IPs are never stored. */
    signupIpHash: text("signup_ip_hash"),
    signupAsn: integer("signup_asn"),
    welcomeBonusCredited: boolean("welcome_bonus_credited").notNull().default(false),
    trustScore: integer("trust_score"),
    isFrozen: boolean("is_frozen").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uidx").on(t.email)],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fingerprintHash: text("fingerprint_hash").notNull(),
    userAgent: text("user_agent"),
    extensionVersion: text("extension_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("devices_user_fp_uidx").on(t.userId, t.fingerprintHash)],
);

/** Refresh-token sessions for the extension and web. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

/**
 * Geo-diversity signal for fraud scoring. Each row records a distinct
 * (geo cluster, ASN, day) a user authenticated from — the raw IP is hashed
 * for equality checks and never stored in plaintext.
 */
export const userNetworkEvents = pgTable(
  "user_network_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    geoCluster: text("geo_cluster").notNull(),
    asn: integer("asn"),
    seenOn: text("seen_on").notNull(), // YYYY-MM-DD
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_network_events_dedup").on(t.userId, t.ipHash, t.seenOn),
    index("user_network_events_user_idx").on(t.userId, t.createdAt),
  ],
);

export const advertisers = pgTable(
  "advertisers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    companyName: text("company_name").notNull(),
    website: text("website"),
    balanceMicro: bigint("balance_micro", { mode: "bigint" }).notNull().default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("advertisers_email_uidx").on(t.email)],
);

/**
 * Refresh-token sessions for the advertiser portal. Advertiser tokens are
 * short-lived and rotatable so a lost portal session can actually be revoked;
 * only the hash of the refresh token is stored.
 */
export const advertiserSessions = pgTable(
  "advertiser_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("advertiser_sessions_advertiser_idx").on(t.advertiserId)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    headline: text("headline").notNull(),
    bodyText: text("body_text").notNull(),
    ctaText: text("cta_text").notNull(),
    targetUrl: text("target_url").notNull(),
    dailyBudgetMicro: bigint("daily_budget_micro", { mode: "bigint" }).notNull(),
    /** Bid per verified 5s view, micro-dollars. */
    cpiMicro: bigint("cpi_micro", { mode: "bigint" }).notNull(),
    targetPlatforms: jsonb("target_platforms").$type<string[]>().notNull().default([]),
    /** Geo clusters to serve in (e.g. ["NA-EAST","EU-WEST"]); empty = worldwide. */
    targetGeoClusters: jsonb("target_geo_clusters").$type<string[]>().notNull().default([]),
    /** Laya auto-moderation outcome, recorded at creation. */
    moderationDecision: moderationDecisionEnum("moderation_decision"),
    moderationScore: integer("moderation_score"),
    moderationReasons: jsonb("moderation_reasons").$type<string[]>().notNull().default([]),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    maxPerDayPerUser: integer("max_per_day_per_user").notNull().default(3),
    cooldownSec: integer("cooldown_sec").notNull().default(1800),
    spentTodayMicro: bigint("spent_today_micro", { mode: "bigint" }).notNull().default(sql`0`),
    spentTotalMicro: bigint("spent_total_micro", { mode: "bigint" }).notNull().default(sql`0`),
    spendDate: text("spend_date").notNull().default(""), // YYYY-MM-DD of spentTodayMicro
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_status_idx").on(t.status)],
);

/**
 * A/B creative variants. A campaign's own copy is variant "A"; additional
 * variants (B, C…) are rows here. Each is moderated by Laya independently and
 * rotates in only once approved. Budgets and bids stay at the campaign level
 * so variants share one budget — the experiment never overspends.
 */
export const campaignVariants = pgTable(
  "campaign_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    label: text("label").notNull(), // "B", "C", …
    headline: text("headline").notNull(),
    bodyText: text("body_text").notNull(),
    ctaText: text("cta_text").notNull(),
    moderationDecision: moderationDecisionEnum("moderation_decision"),
    moderationScore: integer("moderation_score"),
    moderationReasons: jsonb("moderation_reasons").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaign_variants_campaign_idx").on(t.campaignId)],
);

/**
 * Referral attribution. One row per referred user. The bonus vests only when
 * the referred user crosses REFERRAL_QUALIFY_EARNINGS_USD in verified views,
 * which makes fake-account farming unprofitable.
 */
export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    referrerId: uuid("referrer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referredUserId: uuid("referred_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Hashed IP + fingerprint hashes recorded at signup for self-referral checks. */
    referredIpHash: text("referred_ip_hash"),
    referredFingerprintHash: text("referred_fingerprint_hash"),
    status: referralStatusEnum("status").notNull().default("pending"),
    /** Verified-view earnings the referred user had when last evaluated. */
    qualifiedEarningsMicro: bigint("qualified_earnings_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    bonusMicro: bigint("bonus_micro", { mode: "bigint" }).notNull().default(sql`500000`),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("referrals_referred_uidx").on(t.referredUserId),
    index("referrals_referrer_idx").on(t.referrerId),
  ],
);

/**
 * One lease per (user, campaign, issue) — single-use, consumed when a
 * telemetry event bearing its token is accepted.
 */
export const adLeases = pgTable(
  "ad_leases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedImpressionId: uuid("consumed_impression_id"),
  },
  (t) => [
    index("ad_leases_user_idx").on(t.userId),
    index("ad_leases_expiry_idx").on(t.expiresAt),
  ],
);

export const telemetryBatches = pgTable(
  "telemetry_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    extensionVersion: text("extension_version"),
    eventCount: integer("event_count").notNull(),
    acceptedCount: integer("accepted_count").notNull(),
    flaggedCount: integer("flagged_count").notNull().default(0),
    /** Serialized cadence-analysis findings for audit. */
    cadenceFindings: jsonb("cadence_findings").$type<string[]>().notNull().default([]),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("telemetry_batches_user_idx").on(t.userId, t.receivedAt)],
);

export const impressions = pgTable(
  "impressions",
  {
    id: uuid("id").primaryKey(), // client-generated UUIDv4, idempotency key
    batchId: uuid("batch_id")
      .notNull()
      .references(() => telemetryBatches.id, { onDelete: "cascade" }),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => adLeases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    /** Which creative variant was served; null = the base (variant A). */
    variantId: uuid("variant_id").references(() => campaignVariants.id, { onDelete: "set null" }),
    platform: text("platform").notNull(),
    placement: text("placement").notNull(),
    displayMode: text("display_mode").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    aiWaitDurationMs: integer("ai_wait_duration_ms").notNull(),
    cumulativeVisibleMs: integer("cumulative_visible_ms").notNull(),
    hoverMs: integer("hover_ms").notNull().default(0),
    hoverIntentional: boolean("hover_intentional").notNull().default(false),
    /** Coarse geo cluster resolved server-side from the client IP. Never a raw IP. */
    geoCluster: text("geo_cluster"),
    earned: boolean("earned").notNull(),
    earnedMicro: bigint("earned_micro", { mode: "bigint" }).notNull().default(sql`0`),
    status: impressionStatusEnum("status").notNull(),
    rejectionReasons: jsonb("rejection_reasons").$type<string[]>().notNull().default([]),
    pohi: jsonb("pohi").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("impressions_user_idx").on(t.userId, t.createdAt),
    index("impressions_campaign_idx").on(t.campaignId, t.createdAt),
  ],
);

/**
 * Double-entry ledger. Every credit has a matching debit. Amounts in
 * micro-dollars; positive = credit to `account`, negative = debit.
 * Account naming: "user:{id}", "advertiser:{id}", "platform:revenue",
 * "platform:promo_liability".
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    account: text("account").notNull(),
    amountMicro: bigint("amount_micro", { mode: "bigint" }).notNull(),
    referenceType: text("reference_type"), // "impression" | "payout" | "social_task" | ...
    referenceId: uuid("reference_id"),
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_account_idx").on(t.account, t.createdAt),
    index("ledger_reference_idx").on(t.referenceType, t.referenceId),
  ],
);

export const socialTasks = pgTable(
  "social_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskType: taskPlatformEnum("task_type").notNull(),
    postUrl: text("post_url").notNull(),
    screenshotKey: text("screenshot_key").notNull(),
    status: taskStatusEnum("status").notNull().default("pending"),
    rewardMicro: bigint("reward_micro", { mode: "bigint" }).notNull().default(sql`100000`),
    /** Laya auto-moderation outcome for the submitted proof. */
    moderationDecision: moderationDecisionEnum("moderation_decision"),
    moderationScore: integer("moderation_score"),
    moderationReasons: jsonb("moderation_reasons").$type<string[]>().notNull().default([]),
    reviewerNotes: text("reviewer_notes"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_tasks_user_idx").on(t.userId, t.createdAt),
    // One live reward per post per user; a rejected proof may be retried.
    uniqueIndex("social_tasks_user_post_uidx")
      .on(t.userId, t.postUrl)
      .where(sql`status <> 'rejected'`),
  ],
);

export const payoutDestinations = pgTable(
  "payout_destinations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    method: payoutMethodEnum("method").notNull(),
    /** Normalized (lowercased / canonical) destination address or email. */
    addressNormalized: text("address_normalized").notNull(),
    addressDisplay: text("address_display").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payout_dest_user_uidx").on(t.userId, t.method, t.addressNormalized),
    // One destination (per method) belongs to one account, enforced in the DB
    // so two concurrent requests cannot claim it for different users.
    uniqueIndex("payout_dest_method_address_uidx").on(t.method, t.addressNormalized),
    index("payout_dest_address_idx").on(t.addressNormalized),
  ],
);

export const payoutRequests = pgTable(
  "payout_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => payoutDestinations.id, { onDelete: "restrict" }),
    amountMicro: bigint("amount_micro", { mode: "bigint" }).notNull(),
    status: payoutStatusEnum("status").notNull().default("requested"),
    trustScoreAtRequest: integer("trust_score_at_request"),
    trustBreakdown: jsonb("trust_breakdown"),
    processorReference: text("processor_reference"),
    failureReason: text("failure_reason"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("payout_requests_user_idx").on(t.userId, t.requestedAt)],
);

export const fraudLogs = pgTable(
  "fraud_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    severity: fraudSeverityEnum("severity").notNull(),
    rule: text("rule").notNull(), // e.g. "cv_collapse", "lease_replay", "sybil_payout"
    detail: jsonb("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fraud_logs_user_idx").on(t.userId, t.createdAt)],
);

export const clickEvents = pgTable(
  "click_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    impressionId: uuid("impression_id").references(() => impressions.id, {
      onDelete: "set null",
    }),
    /** The signed lease that authorized the click; one click per lease. */
    leaseId: uuid("lease_id").references(() => adLeases.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Coarse geo cluster from the click request's IP; raw IP never stored. */
    geoCluster: text("geo_cluster"),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("click_events_campaign_idx").on(t.campaignId, t.clickedAt),
    // At most one click per impression and per lease; retries are idempotent.
    uniqueIndex("click_events_impression_uidx").on(t.impressionId),
    uniqueIndex("click_events_lease_uidx").on(t.leaseId),
  ],
);

export type User = typeof users.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type AdLease = typeof adLeases.$inferSelect;
export type Impression = typeof impressions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type SocialTask = typeof socialTasks.$inferSelect;
export type PayoutRequest = typeof payoutRequests.$inferSelect;
export type FraudLog = typeof fraudLogs.$inferSelect;
