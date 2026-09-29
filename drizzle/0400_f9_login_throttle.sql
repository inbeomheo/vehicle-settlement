CREATE TABLE login_throttles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  scope text NOT NULL CHECK (scope IN ('ACCOUNT', 'IP')),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_throttles_updated_idx ON login_throttles (updated_at);
