ALTER TABLE projects ALTER COLUMN evidence_policy SET DEFAULT 'NONE';
--> statement-breakpoint
ALTER TABLE driver_join_links ADD COLUMN counterparty_id uuid REFERENCES counterparties(id);
--> statement-breakpoint
ALTER TABLE invites ADD COLUMN counterparty_id uuid REFERENCES counterparties(id);
