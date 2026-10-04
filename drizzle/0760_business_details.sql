ALTER TABLE counterparties
  ADD COLUMN representative_name text CHECK (char_length(representative_name) <= 200),
  ADD COLUMN address text CHECK (char_length(address) <= 500),
  ADD COLUMN business_type text CHECK (char_length(business_type) <= 100),
  ADD COLUMN business_item text CHECK (char_length(business_item) <= 100);
--> statement-breakpoint
ALTER TABLE company_settings
  ADD COLUMN business_type text CHECK (char_length(business_type) <= 100),
  ADD COLUMN business_item text CHECK (char_length(business_item) <= 100);
