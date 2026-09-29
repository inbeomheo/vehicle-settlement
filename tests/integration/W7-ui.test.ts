import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.stubGlobal('React', React);
const state = vi.hoisted(() => ({ ledger: null as unknown, statement: null as unknown }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 's' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../src/components/manager/common', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRemote: (url: string) => ({
    data: url.includes('ledger') ? state.ledger : { unpaid_amount: 880000, unpaid_count: 1 },
    loading: false,
    error: '',
  }),
}));
vi.mock('../../src/app/m/statements/ui', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useResource: () => ({ data: state.statement, loading: false, error: '' }),
}));
import { Dashboard } from '../../src/components/manager/dashboard';
import { ReviewInbox } from '../../src/components/manager/ledger';
import StatementPage from '../../src/app/m/statements/[id]/page';
import { canAccessManagerPage } from '../../src/server/auth/manager-access';
it('1. 현장 담당자 가져오기 페이지 허용', () => {
  expect(canAccessManagerPage('SITE_MANAGER', '/m/import')).toBe(true);
});
it('4. 현장 담당자 미지급 금액은 유지하고 정산 링크 대신 담당자 안내', () => {
  const html = renderToStaticMarkup(createElement(Dashboard, { role: 'SITE_MANAGER' } as never));
  expect(html).toContain('880,000원');
  expect(html).toContain('정산 담당자 확인');
  expect(html).not.toContain('href="/m/payments');
});
it('12. 명세 상세 수량 2.500을 2.5로 표시', () => {
  state.statement = {
    id: 's',
    status: 'CONFIRMED',
    direction: 'PAYABLE',
    items: [{ id: 'i', inclusion: 'INCLUDED', snapshot: { quantity: '2.500', billing_unit: 'PER_DAY' } }],
    payments: [],
    replacements: [],
    grand_total: 0,
    tax_total: 0,
    supply_total: 0,
  };
  const html = renderToStaticMarkup(createElement(StatementPage));
  expect(html).toContain('수량 2.5');
  expect(html).not.toContain('2.500');
});
it('13. 검수함 고유 경로/운행 수 및 검수 전 기본·추가 금액과 요청비 표시', () => {
  state.ledger = {
    rows: [
      {
        id: 'u',
        use_no: 'U1',
        use_date: '2026-09-02',
        plate_no: '서울80가1001',
        origin: '인천 / 인천 / 인천',
        destination: '서울 / 서울 / 서울',
        route_summary: '인천 → 서울 외 2회',
        review_base_amount: 300000,
        review_extra_amount: 5000,
        review_total_amount: 305000,
        has_requested_extra: true,
      },
    ],
    total: 1,
  };
  const html = renderToStaticMarkup(createElement(ReviewInbox));
  expect(html).toContain('인천 → 서울 외 2회');
  expect(html).toContain('305,000원');
  expect(html).toContain('기본 300,000원');
  expect(html).toContain('추가비 5,000원');
  expect(html).toContain('요청 추가비 확인 필요');
});
