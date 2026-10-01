import Decimal from 'decimal.js';
import { calculateTax, computeAmount, type TaxMode, type Rounding } from '../server/domain/money';

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

/** 계약 계산액대로면 계약 단가, 직접 확정한 금액이면 정수로 나누어지는 실제 적용 단가. */
export function displayUnitPrice(
  line: {
    unit_price: number | null;
    charge_type?: string | null;
    quantity?: string | number | null;
    computed_amount?: number | null;
    tax_mode?: TaxMode;
    rounding?: Rounding;
  },
  supply: number | null,
): number | null {
  const unitPrice = line.unit_price ?? null;
  if (supply == null) return unitPrice;
  const quantity = new Decimal(line.quantity ?? 0);
  if (unitPrice !== null) {
    // New snapshots preserve the original calculation, including VAT and minimum charges.
    // Older snapshots can only use their frozen quantity and unit price as the basis.
    const computed = line.computed_amount ?? computeAmount(quantity.toString(), unitPrice, line.rounding);
    const contractSupply = calculateTax(computed, line.tax_mode ?? 'VAT_EXCLUDED').supply;
    if (contractSupply === supply) return unitPrice;
  }
  if ((unitPrice === null && line.charge_type !== 'BASE') || !quantity.isPositive()) return null;
  const price = new Decimal(supply).div(quantity);
  return price.isInteger() && price.abs().lte(Number.MAX_SAFE_INTEGER) ? price.toNumber() : null;
}
