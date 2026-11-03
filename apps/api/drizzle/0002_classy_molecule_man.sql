ALTER TABLE "click_events" ADD COLUMN "lease_id" uuid;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_lease_id_ad_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."ad_leases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "click_events_lease_uidx" ON "click_events" USING btree ("lease_id");