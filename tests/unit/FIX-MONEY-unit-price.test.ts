import { expect, it } from 'vitest';
import { displayUnitPrice } from '../../src/shared/charge-amount';
it.each([
  { quantity: '3', supply: 100, expected: null },
  { quantity: '0.003', supply: 1, expected: null },
  { quantity: '0.125', supply: 1, expected: 8 },
  { quantity: '0', supply: 100, expected: null },
  { quantity: null, supply: 100, expected: null },
  { quantity: '1', supply: null, expected: null },
  { quantity: '1', supply: 0, expected: 0 },
])('직접 확정 단가를 반올림하지 않는다: $quantity / $supply', ({ quantity, supply, expected }) => {
  expect(displayUnitPrice({ charge_type: 'BASE', unit_price: null, quantity }, supply)).toBe(expected);
});
it('기존 확정 스냅샷도 계약 계산액과 다른 공급가의 적용 단가를 표시한다', () => {
  expect(displayUnitPrice({ charge_type: 'BASE', unit_price: 300000, quantity: '1' }, 140000)).toBe(140000);
});
