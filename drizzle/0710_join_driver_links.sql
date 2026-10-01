CREATE TABLE "driver_join_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "project_ids" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_registrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_request_id" uuid NOT NULL UNIQUE,
  "request_hash" text NOT NULL,
  "link_id" uuid REFERENCES "driver_join_links"("id"),
  "invite_id" uuid REFERENCES "invites"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "driver_registration_source_check" CHECK ((link_id IS NULL) <> (invite_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX "driver_registrations_link_idx" ON "driver_registrations" ("link_id");
