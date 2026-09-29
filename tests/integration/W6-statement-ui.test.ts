import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.stubGlobal('React', React);
const state = vi.hoisted(() => ({ query: 'state=PAID', statement: null as Record<string, unknown> | null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.query),
  useParams: () => ({ id: 'statement-id' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../../src/app/m/statements/ui', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useResource: (url: string) => ({
    data: url === '/api/statements/statement-id' ? state.statement : null,
    loading: false,
    error: '',
    reload: vi.fn(),
  }),
}));
import PaymentsPage from '../../src/app/m/payments/page';
import StatementPage from '../../src/app/m/statements/[id]/page';

describe('W6 정산 화면 회귀', () => {
  it.each(['state=PAID', 'status=PAID', 'state=PAID&status=UNPAID'])(
    '9: URL %s를 지급 조회 초기 상태에 반영한다',
    (query) => {
      state.query = query;
      expect(renderToStaticMarkup(createElement(PaymentsPage))).toContain('value="PAID" selected=""');
    },
  );
  it('10: 초안 편집 화면에서 추가 후보를 조회하고 기존 항목을 제외할 수 있다', () => {
    state.statement = {
      id: 'statement-id',
      direction: 'PAYABLE',
      status: 'DRAFT',
      version: 1,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      counterparty_id: 'party-id',
      items: [
        {
          id: 'item-id',
          charge_line_id: 'line-id',
          inclusion: 'INCLUDED',
          supply_amount: 300000,
          tax_amount: 0,
          snapshot: { use_no: 'U-2609-001', billing_unit: 'PER_DAY' },
        },
      ],
      supply_total: 300000,
      tax_total: 0,
      grand_total: 300000,
      payments: [],
      replacements: [],
      payment_status: 'UNPAID',
    };
    const markup = renderToStaticMarkup(createElement(StatementPage));
    expect(markup).toContain('추가 후보 조회');
    expect(markup).toContain('value="EXCLUDED"');
    state.statement = null;
  });
});
