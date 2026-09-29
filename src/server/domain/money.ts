import Decimal from 'decimal.js';
export type Rounding = 'HALF_UP' | 'DOWN' | 'UP';
export type TaxMode = 'VAT_EXCLUDED' | 'VAT_INCLUDED' | 'TAX_EXEMPT';
const modes = { HALF_UP: Decimal.ROUND_HALF_UP, DOWN: Decimal.ROUND_DOWN, UP: Decimal.ROUND_UP } as const;
export function won(value: Decimal.Value, rounding: Rounding = 'HALF_UP'): number {
  const d = new Decimal(value).toDecimalPlaces(0, modes[rounding]);
  if (!d.isFinite() || d.abs().gt(2147483647)) throw new RangeError('금액 범위를 초과했습니다.');
  return d.toNumber();
}
export function computeAmount(quantity: string, unitPrice: number, rounding: Rounding = 'HALF_UP', minCharge?: number | null): number {
  const amount = new Decimal(won(new Decimal(quantity).mul(unitPrice), rounding));
  return won(minCharge == null ? amount : Decimal.max(amount, minCharge));
}
export function calculateTax(amount: number, mode: TaxMode): { supply: number; tax: number; total: number } {
  const supply = mode === 'VAT_INCLUDED' ? won(new Decimal(amount).div('1.1')) : won(amount);
  const tax = mode === 'TAX_EXEMPT' ? 0 : mode === 'VAT_INCLUDED' ? won(new Decimal(amount).minus(supply)) : won(new Decimal(supply).mul('0.1'));
  return { supply, tax, total: won(new Decimal(supply).plus(tax)) };
}
// Review overrides are always final supply, including VAT_INCLUDED contracts.
export function taxFromSupply(supply: number, mode: TaxMode): number { return mode === 'TAX_EXEMPT' ? 0 : won(new Decimal(supply).mul('0.1')); }
export function sumMoney(values: (number | null)[]): number {
  const total = values.reduce<Decimal>((a, b) => a.plus(b ?? 0), new Decimal(0));
  if (!total.isInteger() || total.abs().gt(Number.MAX_SAFE_INTEGER)) throw new RangeError('합계 금액 범위를 초과했습니다.');
  return total.toNumber();
}
