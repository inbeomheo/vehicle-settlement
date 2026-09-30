import { calculateTax, type TaxMode } from '../server/domain/money';

type EstimateLine = {
  charge_type: string;
  computed_amount: number | null;
  requested_amount: number | null;
  included_in_base?: boolean;
  agreement_snapshot?: Record<string, unknown> | null;
};

/** Stored proposals follow the line's tax mode. Approval overrides are supply amounts. */
export function proposedAmount(line?: EstimateLine): number | null {
  if (!line) return null;
  if (line.included_in_base) return 0;
  return line.charge_type === 'BASE'
    ? (line.requested_amount ?? line.computed_amount)
    : (line.computed_amount ?? line.requested_amount);
}

export function proposedSupply(line: EstimateLine & { tax_mode: TaxMode }): number | null {
  const amount = proposedAmount(line);
  return amount === null || line.charge_type === 'ADJUSTMENT'
    ? amount
    : calculateTax(amount, line.tax_mode).supply;
}

export function contractAmount(line: EstimateLine): number | null {
  const imported = line.agreement_snapshot?.contract_computed_amount;
  return typeof imported === 'number' ? imported : line.computed_amount;
}

export function differsFromContract(line: EstimateLine): boolean {
  const amount = line.requested_amount ?? line.computed_amount;
  return (
    line.charge_type === 'BASE' &&
    contractAmount(line) !== null &&
    amount !== null &&
    contractAmount(line) !== amount
  );
}
