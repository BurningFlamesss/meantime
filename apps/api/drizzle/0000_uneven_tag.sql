CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'exhausted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."fraud_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."impression_status" AS ENUM('verified', 'rejected', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('welcome_bonus', 'ad_revenue_share', 'social_task_reward', 'referral_bonus', 'advertiser_deposit', 'advertiser_spend', 'payout_debit', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."moderation_decision" AS ENUM('auto_approved', 'auto_rejected', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('paypal', 'stripe_connect', 'wise', 'usdc', 'usdt');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('requested', 'auditing', 'approved', 'paid', 'rejected', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'qualified', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."task_platform" AS ENUM('x', 'linkedin', 'reddit', 'chrome_web_store', 'other');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "ad_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"campaign_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_impression_id" uuid
);
--> statement-breakpoint
CREATE TABLE "advertisers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"company_name" text NOT NULL,
	"website" text,
	"balance_micro" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"label" text NOT NULL,
	"headline" text NOT NULL,
	"body_text" text NOT NULL,
	"cta_text" text NOT NULL,
	"moderation_decision" "moderation_decision",
	"moderation_score" integer,
	"moderation_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"headline" text NOT NULL,
	"body_text" text NOT NULL,
	"cta_text" text NOT NULL,
	"target_url" text NOT NULL,
	"daily_budget_micro" bigint NOT NULL,
	"cpi_micro" bigint NOT NULL,
	"target_platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_geo_clusters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"moderation_decision" "moderation_decision",
	"moderation_score" integer,
	"moderation_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"moderated_at" timestamp with time zone,
	"max_per_day_per_user" integer DEFAULT 3 NOT NULL,
	"cooldown_sec" integer DEFAULT 1800 NOT NULL,
	"spent_today_micro" bigint DEFAULT 0 NOT NULL,
	"spent_total_micro" bigint DEFAULT 0 NOT NULL,
	"spend_date" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "click_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"impression_id" uuid,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid,
	"geo_cluster" text,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"user_agent" text,
	"extension_version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"severity" "fraud_severity" NOT NULL,
	"rule" text NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impressions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"variant_id" uuid,
	"platform" text NOT NULL,
	"placement" text NOT NULL,
	"display_mode" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"ai_wait_duration_ms" integer NOT NULL,
	"cumulative_visible_ms" integer NOT NULL,
	"hover_ms" integer DEFAULT 0 NOT NULL,
	"hover_intentional" boolean DEFAULT false NOT NULL,
	"geo_cluster" text,
	"earned" boolean NOT NULL,
	"earned_micro" bigint DEFAULT 0 NOT NULL,
	"status" "impression_status" NOT NULL,
	"rejection_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pohi" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_type" "ledger_entry_type" NOT NULL,
	"account" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method" "payout_method" NOT NULL,
	"address_normalized" text NOT NULL,
	"address_display" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"amount_micro" bigint NOT NULL,
	"status" "payout_status" DEFAULT 'requested' NOT NULL,
	"trust_score_at_request" integer,
	"trust_breakdown" jsonb,
	"processor_reference" text,
	"failure_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"referred_ip_hash" text,
	"referred_fingerprint_hash" text,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"qualified_earnings_micro" bigint DEFAULT 0 NOT NULL,
	"bonus_micro" bigint DEFAULT 500000 NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_type" "task_platform" NOT NULL,
	"post_url" text NOT NULL,
	"screenshot_key" text NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"reward_micro" bigint DEFAULT 100000 NOT NULL,
	"moderation_decision" "moderation_decision",
	"moderation_score" integer,
	"moderation_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewer_notes" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"extension_version" text,
	"event_count" integer NOT NULL,
	"accepted_count" integer NOT NULL,
	"flagged_count" integer DEFAULT 0 NOT NULL,
	"cadence_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_network_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip_hash" text NOT NULL,
	"geo_cluster" text NOT NULL,
	"asn" integer,
	"seen_on" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"country" text,
	"signup_ip" text,
	"signup_asn" integer,
	"welcome_bonus_credited" boolean DEFAULT false NOT NULL,
	"trust_score" integer,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_leases" ADD CONSTRAINT "ad_leases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_leases" ADD CONSTRAINT "ad_leases_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_leases" ADD CONSTRAINT "ad_leases_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_impression_id_impressions_id_fk" FOREIGN KEY ("impression_id") REFERENCES "public"."impressions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_logs" ADD CONSTRAINT "fraud_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_batch_id_telemetry_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."telemetry_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_lease_id_ad_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."ad_leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_variant_id_campaign_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."campaign_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_destination_id_payout_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."payout_destinations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_tasks" ADD CONSTRAINT "social_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_batches" ADD CONSTRAINT "telemetry_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_batches" ADD CONSTRAINT "telemetry_batches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_network_events" ADD CONSTRAINT "user_network_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_leases_user_idx" ON "ad_leases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ad_leases_expiry_idx" ON "ad_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisers_email_uidx" ON "advertisers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "campaign_variants_campaign_idx" ON "campaign_variants" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "click_events_campaign_idx" ON "click_events" USING btree ("campaign_id","clicked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_fp_uidx" ON "devices" USING btree ("user_id","fingerprint_hash");--> statement-breakpoint
CREATE INDEX "fraud_logs_user_idx" ON "fraud_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "impressions_user_idx" ON "impressions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "impressions_campaign_idx" ON "impressions" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_account_idx" ON "ledger_entries" USING btree ("account","created_at");--> statement-breakpoint
CREATE INDEX "ledger_reference_idx" ON "ledger_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_dest_user_uidx" ON "payout_destinations" USING btree ("user_id","method","address_normalized");--> statement-breakpoint
CREATE INDEX "payout_dest_address_idx" ON "payout_destinations" USING btree ("address_normalized");--> statement-breakpoint
CREATE INDEX "payout_requests_user_idx" ON "payout_requests" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referred_uidx" ON "referrals" USING btree ("referred_user_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "social_tasks_user_idx" ON "social_tasks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_batches_user_idx" ON "telemetry_batches" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_network_events_dedup" ON "user_network_events" USING btree ("user_id","ip_hash","seen_on");--> statement-breakpoint
CREATE INDEX "user_network_events_user_idx" ON "user_network_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree ("email");