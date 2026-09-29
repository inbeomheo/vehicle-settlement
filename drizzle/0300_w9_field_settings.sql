CREATE TYPE form_field_mode AS ENUM ('HIDDEN', 'OPTIONAL', 'REQUIRED');
--> statement-breakpoint
CREATE TABLE form_field_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id),
  field_key text NOT NULL CHECK (field_key IN (
    'end_date', 'work_type', 'requester', 'cargo_desc', 'operation_status', 'notes',
    'via', 'cargo', 'quantity', 'quantity_unit', 'hours', 'depart_at', 'arrive_at',
    'trip_status', 'is_empty_return', 'trip_notes', 'extra_charges'
  )),
  driver_mode form_field_mode,
  manager_mode form_field_mode,
  updated_by uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX form_field_settings_company_unique ON form_field_settings(field_key) WHERE project_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX form_field_settings_project_unique ON form_field_settings(project_id, field_key) WHERE project_id IS NOT NULL;
