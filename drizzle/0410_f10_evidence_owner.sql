ALTER TABLE evidence ADD COLUMN owner_driver_id uuid REFERENCES drivers(id);
--> statement-breakpoint
-- Reconstruct from serialized use versions, not uploader identities or wall
-- clocks (transaction start timestamps can precede acquisition of the use lock).
-- Full observations come from immutable audit/revision payloads and current state.
CREATE TEMP TABLE f10_use_observations ON COMMIT DROP AS
WITH snapshots AS (
  SELECT a.entity_id AS use_id, payload.value AS snapshot
  FROM audit_logs a
  CROSS JOIN LATERAL (VALUES (a.before), (a.after)) AS payload(value)
  WHERE a.entity_type = 'vehicle_use'
  UNION ALL
  SELECT vehicle_use_id, snapshot FROM use_revisions
  UNION ALL
  SELECT u.id, jsonb_build_object(
    'driver_id', u.driver_id, 'version', u.version,
    'evidence', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id))
      FROM evidence e WHERE e.vehicle_use_id=u.id
        AND e.deleted_at IS NULL AND e.replaced_by_id IS NULL), '[]'::jsonb)
  ) FROM vehicle_uses u
)
SELECT s.use_id, (s.snapshot->>'version')::bigint AS version,
       d.id AS driver_id, s.snapshot->'evidence' AS files
FROM snapshots s JOIN drivers d ON d.id::text = s.snapshot->>'driver_id'
WHERE s.snapshot->>'version' ~ '^[0-9]{1,10}$'
  AND jsonb_typeof(s.snapshot->'evidence') = 'array';
--> statement-breakpoint
CREATE INDEX ON f10_use_observations (use_id, version);
--> statement-breakpoint
-- A missing -> present boundary with the same driver over at most two version
-- increments proves ownership: creating evidence consumes one increment, while
-- a switch away and back would require two additional increments. Wider gaps,
-- conflicting observations, or no preceding full snapshot remain manager-only.
WITH first_presence AS (
  SELECT e.id, e.vehicle_use_id, min(o.version) AS version
  FROM evidence e JOIN f10_use_observations o ON o.use_id=e.vehicle_use_id
    AND o.files @> jsonb_build_array(jsonb_build_object('id', e.id))
  GROUP BY e.id, e.vehicle_use_id
), candidates AS (
  SELECT DISTINCT f.id, present.driver_id
  FROM first_presence f
  JOIN f10_use_observations present ON present.use_id=f.vehicle_use_id
    AND present.version=f.version
    AND present.files @> jsonb_build_array(jsonb_build_object('id', f.id))
  JOIN f10_use_observations prior ON prior.use_id=f.vehicle_use_id
    AND prior.version BETWEEN f.version-2 AND f.version-1
    AND prior.driver_id=present.driver_id
    AND NOT (prior.files @> jsonb_build_array(jsonb_build_object('id', f.id)))
  WHERE NOT EXISTS (
    SELECT 1 FROM f10_use_observations conflict
    WHERE conflict.use_id=f.vehicle_use_id
      AND conflict.version BETWEEN prior.version AND present.version
      AND conflict.driver_id <> present.driver_id
  )
), unambiguous AS (
  SELECT id, min(driver_id::text)::uuid AS driver_id
  FROM candidates GROUP BY id HAVING count(DISTINCT driver_id)=1
)
UPDATE evidence e SET owner_driver_id=u.driver_id
FROM unambiguous u WHERE e.id=u.id;
--> statement-breakpoint
CREATE FUNCTION preserve_evidence_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_driver_id IS DISTINCT FROM OLD.owner_driver_id
     OR NEW.vehicle_use_id IS DISTINCT FROM OLD.vehicle_use_id THEN
    RAISE EXCEPTION '증빙 귀속 기사와 사용 건은 변경할 수 없습니다.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evidence_owner_immutable
BEFORE UPDATE OF owner_driver_id, vehicle_use_id ON evidence
FOR EACH ROW EXECUTE FUNCTION preserve_evidence_owner();
