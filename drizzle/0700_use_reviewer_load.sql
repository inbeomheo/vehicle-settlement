ALTER TABLE "vehicle_uses" ADD COLUMN "reviewer_user_id" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD COLUMN "load_tonnage" numeric(10, 3);
--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "use_load_tonnage_check" CHECK ("load_tonnage" IS NULL OR "load_tonnage" > 0);
--> statement-breakpoint
CREATE INDEX "uses_reviewer_idx" ON "vehicle_uses" ("reviewer_user_id", "review_status");
