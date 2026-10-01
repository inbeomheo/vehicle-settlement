ALTER TABLE form_field_settings DROP CONSTRAINT form_field_settings_field_key_check;
--> statement-breakpoint
ALTER TABLE form_field_settings ADD CONSTRAINT form_field_settings_field_key_check CHECK (field_key IN ('reviewer', 'load_tonnage', 'end_date', 'work_type', 'requester', 'cargo_desc', 'operation_status', 'notes', 'via', 'cargo', 'quantity', 'quantity_unit', 'hours', 'depart_at', 'arrive_at', 'trip_status', 'is_empty_return', 'trip_notes', 'extra_charges'));
