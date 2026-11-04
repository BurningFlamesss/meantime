ALTER TABLE "campaigns" ADD COLUMN "duration_sec" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "impressions" ADD COLUMN "duration_sec" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "max_ad_duration_sec" integer DEFAULT 15 NOT NULL;