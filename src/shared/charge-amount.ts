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

/**
 * 명세·출력의 단가 칸. 계약 단가가 없고 기사가 금액을 직접 넣은 기본운임은
 * 확정 공급가 ÷ 수량을 단가로 보여 준다(현장 양식처럼 수량 1 · 단가 = 금액).
 */
export function displayUnitPrice(
  line: { unit_price: number | null; charge_type?: string | null; quantity?: string | number | null },
  supply: number | null,
): number | null {
  if (line.unit_price !== null) return line.unit_price;
  const quantity = Number(line.quantity);
  if (line.charge_type !== 'BASE' || supply === null || !(quantity > 0)) return null;
  return Math.round(supply / quantity);
}
