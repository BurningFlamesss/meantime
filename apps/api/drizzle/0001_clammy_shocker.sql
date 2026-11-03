-- Collapse legacy duplicates before the unique indexes are created. The
-- earliest row wins; later identical rows added no information.
DELETE FROM "click_events" a
USING "click_events" b
WHERE a."impression_id" IS NOT NULL
  AND a."impression_id" = b."impression_id"
  AND (a."clicked_at", a."id") > (b."clicked_at", b."id");--> statement-breakpoint
DELETE FROM "social_tasks" a
USING "social_tasks" b
WHERE a."status" <> 'rejected'
  AND b."status" <> 'rejected'
  AND a."user_id" = b."user_id"
  AND a."post_url" = b."post_url"
  AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX "click_events_impression_uidx" ON "click_events" USING btree ("impression_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_dest_method_address_uidx" ON "payout_destinations" USING btree ("method","address_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "social_tasks_user_post_uidx" ON "social_tasks" USING btree ("user_id","post_url") WHERE status <> 'rejected';