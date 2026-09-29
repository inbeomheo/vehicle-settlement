CREATE SEQUENCE use_no_seq;
--> statement-breakpoint
CREATE SEQUENCE statement_no_seq;
--> statement-breakpoint
CREATE FUNCTION protect_referenced_rate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM charge_lines WHERE rate_agreement_id = OLD.id) THEN
    IF ROW(NEW.unit_price, NEW.billing_unit, NEW.valid_from, NEW.tax_mode, NEW.rounding, NEW.min_charge, NEW.direction, NEW.counterparty_id, NEW.project_id, NEW.vehicle_type, NEW.tonnage)
       IS DISTINCT FROM ROW(OLD.unit_price, OLD.billing_unit, OLD.valid_from, OLD.tax_mode, OLD.rounding, OLD.min_charge, OLD.direction, OLD.counterparty_id, OLD.project_id, OLD.vehicle_type, OLD.tonnage)
       OR (NEW.valid_to IS DISTINCT FROM OLD.valid_to AND (NEW.valid_to IS NULL OR (OLD.valid_to IS NOT NULL AND NEW.valid_to > OLD.valid_to) OR EXISTS (SELECT 1 FROM charge_lines WHERE rate_agreement_id = OLD.id AND rate_basis_date > NEW.valid_to))) THEN
      RAISE EXCEPTION '참조된 계약은 새 기간 행으로 등록하세요.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER referenced_rate_immutable BEFORE UPDATE ON rate_agreements FOR EACH ROW EXECUTE FUNCTION protect_referenced_rate();
