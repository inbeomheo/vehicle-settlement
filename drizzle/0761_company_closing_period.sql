ALTER TABLE company_settings
  ADD COLUMN closing_start_day integer NOT NULL DEFAULT 19
  CONSTRAINT company_closing_start_day_check CHECK (closing_start_day BETWEEN 1 AND 28);
