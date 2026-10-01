ALTER TABLE push_subscriptions
  ADD COLUMN session_id uuid REFERENCES sessions(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX push_subscriptions_session_idx ON push_subscriptions(session_id);
