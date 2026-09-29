CREATE TYPE "public"."billing_unit" AS ENUM('PER_TRIP', 'PER_DAY', 'HALF_DAY', 'MONTHLY', 'PER_HOUR', 'PER_TON', 'PER_M3', 'LUMP_SUM');--> statement-breakpoint
CREATE TYPE "public"."charge_type" AS ENUM('BASE', 'WAITING', 'TOLL', 'EXTRA_STOP', 'CANCEL_FEE', 'EXPENSE', 'OTHER', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."counterparty_kind" AS ENUM('CARRIER', 'DRIVER_BUSINESS', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."revision_decision" AS ENUM('PENDING', 'APPROVED', 'NEEDS_FIX', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('PAYABLE', 'RECEIVABLE');--> statement-breakpoint
CREATE TYPE "public"."entered_as" AS ENUM('DRIVER_SELF', 'PROXY');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('PHOTO', 'RECEIPT', 'WEIGH_TICKET', 'CONFIRMATION', 'SLIP_NO', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."evidence_policy" AS ENUM('PHOTO_REQUIRED', 'PHOTO_OR_ALTERNATIVE', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('PREVIEW', 'COMMITTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."inclusion" AS ENUM('INCLUDED', 'HELD');--> statement-breakpoint
CREATE TYPE "public"."line_review_status" AS ENUM('PENDING', 'APPROVED', 'HELD', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."operation_status" AS ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('PAYMENT', 'RECEIPT');--> statement-breakpoint
CREATE TYPE "public"."price_status" AS ENUM('PENDING', 'CONFIRMED');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('DRIVER', 'SITE_MANAGER', 'SETTLEMENT_MANAGER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."rounding" AS ENUM('HALF_UP', 'DOWN', 'UP');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('DRAFT', 'CONFIRMED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."tax_mode" AS ENUM('VAT_EXCLUDED', 'VAT_INCLUDED', 'TAX_EXEMPT');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('PENDING', 'UPLOADED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_use_id" uuid NOT NULL,
	"trip_id" uuid,
	"direction" "direction" NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"charge_type" charge_type NOT NULL,
	"billing_unit" "billing_unit" NOT NULL,
	"quantity" numeric(12, 3),
	"unit_price" integer,
	"rate_agreement_id" uuid,
	"rate_basis_date" date NOT NULL,
	"agreement_snapshot" jsonb,
	"tax_mode" "tax_mode" NOT NULL,
	"rounding" "rounding" NOT NULL,
	"computed_amount" integer,
	"requested_amount" integer,
	"approved_amount" integer,
	"tax_amount" integer,
	"price_status" "price_status" DEFAULT 'PENDING' NOT NULL,
	"line_review_status" "line_review_status" DEFAULT 'PENDING' NOT NULL,
	"reason" text,
	"included_in_base" boolean DEFAULT false NOT NULL,
	"adjusts_statement_id" uuid,
	"locked_statement_id" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"biz_no" text,
	"address" text,
	"representative" text,
	"default_tax_mode" "tax_mode" DEFAULT 'VAT_EXCLUDED' NOT NULL,
	"settlement_contact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counterparties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"biz_no" text,
	"kind" "counterparty_kind" NOT NULL,
	"contact_name" text,
	"phone" text,
	"bank_account" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_affiliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliation_dates_check" CHECK ("driver_affiliations"."valid_to" IS NULL OR "driver_affiliations"."valid_to" >= "driver_affiliations"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"default_vehicle_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_use_id" uuid NOT NULL,
	"trip_id" uuid,
	"kind" "evidence_kind" NOT NULL,
	"client_upload_id" text NOT NULL,
	"storage_key" text,
	"original_name" text,
	"mime" text,
	"size" integer,
	"sha256" text,
	"text_value" text,
	"upload_status" "upload_status" DEFAULT 'PENDING' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"replace_reason" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_client_upload_id_unique" UNIQUE("client_upload_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"status" "import_status" DEFAULT 'PREVIEW' NOT NULL,
	"mapping" jsonb,
	"summary" jsonb,
	"rows" jsonb,
	"created_by" uuid NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"driver_id" uuid,
	"project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"amount" integer NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"memo" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"client_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_records_client_request_id_unique" UNIQUE("client_request_id")
);
--> statement-breakpoint
CREATE TABLE "project_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_dates_check" CHECK ("project_assignments"."valid_to" IS NULL OR "project_assignments"."valid_to" >= "project_assignments"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"evidence_policy" "evidence_policy" DEFAULT 'PHOTO_REQUIRED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rate_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"direction" "direction" NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"project_id" uuid,
	"vehicle_type" text,
	"tonnage" numeric(12, 3),
	"billing_unit" "billing_unit" NOT NULL,
	"unit_price" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"tax_mode" "tax_mode" DEFAULT 'VAT_EXCLUDED' NOT NULL,
	"rounding" "rounding" DEFAULT 'HALF_UP' NOT NULL,
	"min_charge" integer,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_dates_check" CHECK ("rate_agreements"."valid_to" IS NULL OR "rate_agreements"."valid_to" >= "rate_agreements"."valid_from"),
	CONSTRAINT "rate_amounts_check" CHECK ("rate_agreements"."unit_price" >= 0 AND ("rate_agreements"."min_charge" IS NULL OR "rate_agreements"."min_charge" >= 0))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "statement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"charge_line_id" uuid NOT NULL,
	"inclusion" "inclusion" DEFAULT 'INCLUDED' NOT NULL,
	"hold_reason" text,
	"snapshot" jsonb,
	"supply_amount" integer,
	"tax_amount" integer,
	"is_active_lock" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_no" text,
	"direction" "direction" NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"title" text,
	"status" "statement_status" DEFAULT 'DRAFT' NOT NULL,
	"counterparty_snapshot" jsonb,
	"issuer_snapshot" jsonb,
	"supply_total" integer DEFAULT 0 NOT NULL,
	"tax_total" integer DEFAULT 0 NOT NULL,
	"grand_total" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"canceled_at" timestamp with time zone,
	"canceled_by" uuid,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"client_request_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"replaces_statement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statements_statement_no_unique" UNIQUE("statement_no"),
	CONSTRAINT "statements_client_request_id_unique" UNIQUE("client_request_id")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_use_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"status" "operation_status" DEFAULT 'COMPLETED' NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"via" text[],
	"depart_at" timestamp with time zone,
	"arrive_at" timestamp with time zone,
	"cargo_desc" text,
	"quantity" numeric(12, 3),
	"quantity_unit" text,
	"hours" numeric(12, 3),
	"is_empty_return" boolean DEFAULT false NOT NULL,
	"notes" text,
	"client_row_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "use_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_use_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" "revision_decision" DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"fix_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login_id" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" "user_role" NOT NULL,
	"driver_id" uuid,
	"all_projects" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_login_id_unique" UNIQUE("login_id"),
	CONSTRAINT "driver_user_link_check" CHECK ("users"."role" <> 'DRIVER' OR "users"."driver_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "vehicle_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"use_no" text NOT NULL,
	"client_request_id" text,
	"use_date" date NOT NULL,
	"end_date" date,
	"project_id" uuid NOT NULL,
	"work_type_id" uuid,
	"requester" text,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"payee_counterparty_id" uuid NOT NULL,
	"customer_counterparty_id" uuid,
	"cargo_desc" text,
	"notes" text,
	"snapshot" jsonb NOT NULL,
	"operation_status" "operation_status" DEFAULT 'PLANNED' NOT NULL,
	"review_status" "review_status" DEFAULT 'DRAFT' NOT NULL,
	"current_revision_no" integer DEFAULT 0 NOT NULL,
	"approved_revision_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"entered_as" "entered_as" NOT NULL,
	"driver_confirmed_at" timestamp with time zone,
	"source_row_hash" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_uses_use_no_unique" UNIQUE("use_no"),
	CONSTRAINT "vehicle_uses_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "vehicle_uses_source_row_hash_unique" UNIQUE("source_row_hash"),
	CONSTRAINT "use_dates_check" CHECK ("vehicle_uses"."end_date" IS NULL OR "vehicle_uses"."end_date" >= "vehicle_uses"."use_date")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plate_no" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"tonnage" numeric(12, 3) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_no_unique" UNIQUE("plate_no")
);
--> statement-breakpoint
CREATE TABLE "work_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_vehicle_use_id_vehicle_uses_id_fk" FOREIGN KEY ("vehicle_use_id") REFERENCES "public"."vehicle_uses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_rate_agreement_id_rate_agreements_id_fk" FOREIGN KEY ("rate_agreement_id") REFERENCES "public"."rate_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_adjusts_statement_id_statements_id_fk" FOREIGN KEY ("adjusts_statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_locked_statement_id_statements_id_fk" FOREIGN KEY ("locked_statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_affiliations" ADD CONSTRAINT "driver_affiliations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_affiliations" ADD CONSTRAINT "driver_affiliations_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_default_vehicle_id_vehicles_id_fk" FOREIGN KEY ("default_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_vehicle_use_id_vehicle_uses_id_fk" FOREIGN KEY ("vehicle_use_id") REFERENCES "public"."vehicle_uses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_replaced_by_id_evidence_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_agreements" ADD CONSTRAINT "rate_agreements_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_agreements" ADD CONSTRAINT "rate_agreements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_items" ADD CONSTRAINT "statement_items_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_items" ADD CONSTRAINT "statement_items_charge_line_id_charge_lines_id_fk" FOREIGN KEY ("charge_line_id") REFERENCES "public"."charge_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_replaces_statement_id_statements_id_fk" FOREIGN KEY ("replaces_statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_use_id_vehicle_uses_id_fk" FOREIGN KEY ("vehicle_use_id") REFERENCES "public"."vehicle_uses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "use_revisions" ADD CONSTRAINT "use_revisions_vehicle_use_id_vehicle_uses_id_fk" FOREIGN KEY ("vehicle_use_id") REFERENCES "public"."vehicle_uses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "use_revisions" ADD CONSTRAINT "use_revisions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "use_revisions" ADD CONSTRAINT "use_revisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "vehicle_uses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "vehicle_uses_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "vehicle_uses_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "vehicle_uses_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "vehicle_uses_payee_counterparty_id_counterparties_id_fk" FOREIGN KEY ("payee_counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "vehicle_uses_customer_counterparty_id_counterparties_id_fk" FOREIGN KEY ("customer_counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "vehicle_uses_approved_revision_id_use_revisions_id_fk" FOREIGN KEY ("approved_revision_id") REFERENCES "public"."use_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_uses" ADD CONSTRAINT "vehicle_uses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "charge_use_idx" ON "charge_lines" USING btree ("vehicle_use_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_singleton_unique" ON "company_settings" USING btree ((true));--> statement-breakpoint
CREATE INDEX "affiliation_driver_dates_idx" ON "driver_affiliations" USING btree ("driver_id","valid_from");--> statement-breakpoint
CREATE INDEX "evidence_use_idx" ON "evidence" USING btree ("vehicle_use_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_user_key_unique" ON "idempotency_keys" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_active_statement_unique" ON "payment_records" USING btree ("statement_id") WHERE "payment_records"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assignment_user_idx" ON "project_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_item_unique" ON "statement_items" USING btree ("statement_id","charge_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_item_active_lock_unique" ON "statement_items" USING btree ("charge_line_id") WHERE "statement_items"."is_active_lock";--> statement-breakpoint
CREATE UNIQUE INDEX "trips_use_seq_unique" ON "trips" USING btree ("vehicle_use_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_use_client_row_unique" ON "trips" USING btree ("vehicle_use_id","client_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_use_no_unique" ON "use_revisions" USING btree ("vehicle_use_id","revision_no");--> statement-breakpoint
CREATE INDEX "uses_project_date_idx" ON "vehicle_uses" USING btree ("project_id","use_date");--> statement-breakpoint
CREATE INDEX "uses_driver_idx" ON "vehicle_uses" USING btree ("driver_id");