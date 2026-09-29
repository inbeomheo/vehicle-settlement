import { describe, expect, it } from 'vitest';
import { calculateTax, computeAmount, sumMoney, taxFromSupply, won } from '../../src/server/domain/money';
import { reviewAfterEdit, assertTransition } from '../../src/server/domain/states';
describe('정수 원 계산', () => {
  it.each([
    ['HALF_UP', 2],
    ['DOWN', 1],
    ['UP', 2],
  ] as const)('반올림 %s', (mode, result) => expect(computeAmount('1.5', 1, mode)).toBe(result));
  it('decimal 수량, 최소요금, 0원', () => {
    expect(computeAmount('0.1', 3)).toBe(0);
    expect(computeAmount('0.333', 100000)).toBe(33300);
    expect(computeAmount('1', 100, 'DOWN', 1000)).toBe(1000);
    expect(computeAmount('5', 0)).toBe(0);
  });
  it('세금 3종과 음수 조정', () => {
    expect(calculateTax(300000, 'VAT_EXCLUDED')).toEqual({ supply: 300000, tax: 30000, total: 330000 });
    expect(calculateTax(10000, 'VAT_INCLUDED')).toEqual({ supply: 9091, tax: 909, total: 10000 });
    expect(calculateTax(10000, 'TAX_EXEMPT')).toEqual({ supply: 10000, tax: 0, total: 10000 });
    expect(calculateTax(-11000, 'VAT_INCLUDED')).toEqual({ supply: -10000, tax: -1000, total: -11000 });
    expect(taxFromSupply(10000, 'VAT_INCLUDED')).toBe(1000);
  });
  it('라인 합산 및 범위 초과', () => {
    expect(sumMoney([10000, null, -500])).toBe(9500);
    expect(() => won(2147483648)).toThrow(RangeError);
  });
});
it('상태 전이는 운행 상태와 독립', () => {
  expect(reviewAfterEdit('APPROVED', true)).toBe('DRAFT');
  expect(reviewAfterEdit('APPROVED', false)).toBe('SUBMITTED');
  expect(() => assertTransition('DRAFT', 'approve')).toThrow();
});
