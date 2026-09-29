CREATE TABLE "import_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD COLUMN "import_job_id" uuid;--> statement-breakpoint
ALTER TABLE "import_presets" ADD CONSTRAINT "import_presets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_presets_owner_name" ON "import_presets" USING btree ("created_by","name");--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "vehicle_uses_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE no action ON UPDATE no action;