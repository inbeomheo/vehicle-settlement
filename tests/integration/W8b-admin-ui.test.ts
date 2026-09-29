import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { withDatabase } from '../../src/server/db/client';
import { createInvite, revokeInvite } from '../../src/server/services/auth';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';

vi.stubGlobal('React', React);
vi.mock('../../src/components/manager/common', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRemote: (url: string) => ({
    data:
      url === '/api/me'
        ? { role: 'ADMIN' }
        : url === '/api/admin/rates'
          ? [
              {
                id: 'rate',
                name: '일대 계약',
                direction: 'PAYABLE',
                billing_unit: 'PER_DAY',
                unit_price: 300000,
                min_charge: null,
                active: true,
              },
            ]
          : {},
    loading: false,
    error: '',
  }),
}));
import InvitePage from '../../src/app/(auth)/invite/[token]/page';
import { AuditChanges, auditChanges, auditLabel, auditValue } from '../../src/components/manager/audit';
import { Master } from '../../src/components/manager/master';

const database = testDatabase();

it('3. 유효 초대에 회사·이름·역할을 표시하고 무효 초대 폼은 서버 렌더링부터 없다', async () => {
  const s = await setupScenario(database().db);
  await s.f.company({ name: '초대 회사' });
  const invite = await createInvite(s.adminCtx, { role: 'SITE_MANAGER', name: '초대된 담당자' });
  const token = invite.invite_url.split('/').at(-1)!;
  const render = () =>
    withDatabase(database().db, async () =>
      renderToStaticMarkup(await InvitePage({ params: Promise.resolve({ token }) })),
    );
  const valid = await render();
  expect(valid).toContain('초대 회사');
  expect(valid).toContain('초대된 담당자');
  expect(valid).toContain('현장 담당자');
  expect(valid).toContain('<form');
  await revokeInvite(s.adminCtx, invite.id);
  const invalid = await render();
  expect(invalid).toContain('이미 사용되었거나 만료된 초대입니다');
  expect(invalid).not.toContain('<form');
  expect(invalid).not.toContain('초대된 담당자');
});

it('9. 감사 액션·종류가 한국어이며 null은 없음, 변경된 필드만 이전→이후 표로 표시한다', () => {
  for (const [code, text] of Object.entries({
    IMPORT_UPLOAD: '가져오기 파일 등록',
    PAYMENT_VOID: '지급·입금 기록 취소',
    STATEMENT_CONFIRM: '명세 확정',
    import_job: '가져오기 작업',
    IMPORT_PREVIEW_DELETE: '미확정 미리보기 삭제',
  }))
    expect(auditLabel(code)).toBe(text);
  const before = { notes: null, approved_amount: 1000, name: '동일', updated_at: '어제' };
  const after = { notes: '정정', approved_amount: 2000, name: '동일', updated_at: '오늘' };
  const changes = auditChanges(before, after);
  expect(changes.map((change) => change.title)).toEqual(['비고', '승인 공급가']);
  expect(auditValue(null, 'notes')).toBe('없음');
  expect(auditValue(3, 'summary.total')).toBe('3');
  expect(auditValue('RECEIPT', 'kind', 'payment')).toBe('입금');
  expect(auditValue('RECEIPT', 'kind', 'evidence')).toBe('인수증');
  expect(
    auditChanges(null, {
      imported_unit_price: 100,
      applied_contract_rate: true,
      import_job_id: 'job',
      errors: 2,
    }).map((change) => change.title),
  ).toEqual(['가져온 단가', '계약 단가 적용', '가져오기 작업', '오류']);
  const html = renderToStaticMarkup(createElement(AuditChanges, { before, after }));
  expect(html).toContain('이전 → 이후');
  expect(html).toContain('1,000원');
  expect(html).toContain('2,000원');
  expect(html).toContain('없음');
  expect(html).not.toContain('<pre');
  expect(html).not.toContain('approved_amount');
});

it('9. 변경 항목은 첫 6개와 펼칠 수 있는 나머지 표로 표시한다', () => {
  const after = {
    name: '이름',
    phone: '연락처',
    notes: '비고',
    role: 'ADMIN',
    status: 'ACTIVE',
    amount: 1000,
    memo: '메모',
    method: '현금',
  };
  const html = renderToStaticMarkup(createElement(AuditChanges, { before: null, after }));
  expect(html).toContain('변경 항목 2개 더 보기');
  expect(html).toContain('<details>');
  expect(html).not.toContain('>null<');
});

it('11. 계약 최소요금 null은 없음으로 표시하고 모바일 계약 카드에도 같은 값을 쓴다', () => {
  const html = renderToStaticMarkup(createElement(Master, { resource: 'rates' }));
  expect(html).toContain('계약·단가 카드 목록');
  expect(html).toContain('md:hidden');
  expect(html).toContain('hidden md:block');
  expect(html).toContain('최소요금 (원)');
  expect(html.match(/>없음</g)).toHaveLength(2);
  expect(html).not.toContain('미확정');
});
