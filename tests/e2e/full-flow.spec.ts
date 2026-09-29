import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';

test.setTimeout(180000);
async function login(page: Page, id: string) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('아이디', { exact: true }).fill(id);
  await page.getByLabel('비밀번호', { exact: true }).fill(id === 'admin' ? 'admin1234' : 'demo1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(id.startsWith('driver') ? '/d' : '/m');
}
type Use = {
  id: string;
  use_no: string;
  review_status: string;
  entered_as: string;
  use_date: string;
  trips: unknown[];
  charge_lines: { charge_type: string; computed_amount: number; line_review_status: string }[];
};
async function inputUse(
  page: Page,
  options: { manager?: boolean; trips: number; quantity: string; date: string; extra?: boolean; tag: string },
) {
  await page.goto(options.manager ? '/m/uses/new' : '/d/new');
  await expect(page.getByLabel('1회차 출발', { exact: true })).toBeVisible();
  if (options.manager) await page.getByLabel('실제 기사', { exact: true }).selectOption({ label: '김기사' });
  await page.getByLabel('사용일', { exact: true }).fill(options.date);
  await page.getByLabel('현장', { exact: true }).selectOption({ label: '서울 현장' });
  await page.getByLabel('운반 내용', { exact: true }).fill(options.tag);
  for (let i = 1; i <= options.trips; i++) {
    if (i > 1) await page.getByRole('button', { name: '+ 운행 추가', exact: true }).click();
    await page.getByLabel(`${i}회차 출발`, { exact: true }).fill('자재 창고');
    await page.getByLabel(`${i}회차 도착`, { exact: true }).fill(`서울 ${i}문`);
  }
  await page.getByLabel('청구수량', { exact: true }).fill(options.quantity);
  await expect(
    page.getByText(`기본운임 ${options.quantity === '5' ? '500,000' : '300,000'}원`, { exact: true }),
  ).toBeVisible();
  if (options.extra) {
    await page.getByRole('button', { name: '+ 추가 비용', exact: true }).click();
    await page.getByLabel('추가비 1 종류', { exact: true }).selectOption('TOLL');
    await page.getByLabel('추가비 1 요청액 (원)', { exact: true }).fill('5000');
    await page.getByLabel('추가비 1 사유', { exact: true }).fill('통행료 영수증 추가 확인');
  }
  await page.getByLabel('사진·파일 선택', { exact: true }).setInputFiles('public/icons/icon-512.png');
  const created = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/uses' && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: options.manager ? '검수 대기로 제출' : '담당자에게 제출', exact: true })
    .click();
  const response = await created;
  expect(response.status()).toBe(200);
  const use = (await response.json()).data as Use;
  if (!options.manager) await expect(page.getByText('담당자에게 제출 완료', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get(`/api/uses/${use.id}`)).json()).data.review_status)
    .toBe('SUBMITTED');
  return (await (await page.request.get(`/api/uses/${use.id}`)).json()).data as Use;
}
async function approve(page: Page, use: Use) {
  await page.goto(`/m/uses/${use.id}`);
  await page.getByRole('button', { name: '전체 승인 (보류·반려 제외)', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '검수가 완료되었습니다' })).toBeVisible();
}
async function settle(page: Page, party: string, uses: Use[], total: number, prior = false) {
  await page.goto('/m/statements');
  await page.getByRole('button', { name: '새 정산', exact: true }).click();
  await page.getByLabel('거래처', { exact: true }).selectOption({ label: party });
  await page.getByLabel('기간 시작', { exact: true }).fill('2026-09-01');
  await page.getByLabel('기간 종료', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: '후보 조회', exact: true }).click();
  await expect(page.getByRole('button', { name: '초안 만들기' })).toBeVisible();
  const selects = page.getByRole('combobox', { name: /포함 여부$/ });
  for (const select of await selects.all()) {
    const name = await select.getAttribute('aria-label');
    const use = uses.find((u) => name === `${u.use_no} 포함 여부`);
    const eligible = await select.locator('option[value="INCLUDED"]').isEnabled();
    await select.selectOption(use && eligible ? 'INCLUDED' : 'EXCLUDED');
  }
  if (prior) await expect(page.getByText('전월분', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '초안 만들기' }).click();
  await expect(page).toHaveURL(/\/m\/statements\/[a-f0-9-]+$/);
  await page.getByRole('button', { name: '명세 확정', exact: true }).click();
  await page.getByRole('button', { name: '확정', exact: true }).click();
  const heading = page.getByRole('heading', { name: /^PAY-202609-/ });
  await expect(heading).toBeVisible();
  const no = (await heading.textContent())!;
  const id = page.url().split('/').pop()!;
  const statement = (await (await page.request.get(`/api/statements/${id}`)).json()).data;
  expect(statement.grand_total).toBe(total);
  expect(statement.supply_total).toBe(total === 660000 ? 600000 : 500000);
  expect(statement.items.filter((i: { inclusion: string }) => i.inclusion === 'INCLUDED')).toHaveLength(
    uses.length,
  );
  for (const [label, extension] of [
    ['엑셀 다운로드', 'xlsx'],
    ['PDF 다운로드', 'pdf'],
  ]) {
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: label }).click();
    const file = await downloaded;
    expect(await file.failure()).toBeNull();
    expect(file.suggestedFilename()).toContain(`.${extension}`);
    const bytes = await readFile((await file.path())!);
    if (extension === 'pdf') expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
      const text = JSON.stringify(workbook.worksheets[0].getSheetValues());
      expect(text).toContain(no);
      expect(text).toContain(String(total));
      for (const use of uses) expect(text).toContain(use.use_date);
    }
  }
  await page.getByLabel('지급일', { exact: true }).fill('2026-09-29');
  await page.getByLabel('참고번호', { exact: true }).fill('W5-FULL-FLOW');
  await page.getByRole('button', { name: '지급 기록 저장' }).click();
  await expect(page.getByText('지급 완료', { exact: true })).toBeVisible();
  return { id, no };
}
async function driverStatement(page: Page, no: string, state: string) {
  await page.goto('/d/settlements');
  await page.getByLabel('조회 시작일').fill('2026-09-01');
  await page.getByLabel('조회 종료일').fill('2026-09-30');
  await page.getByRole('button', { name: '조회', exact: true }).click();
  await expect(
    page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: no, exact: true }) })
      .getByText(state, { exact: true }),
  ).toBeVisible();
}
test('기사 → 보완·재제출·보류 검수 → 전월분 정산 → 엑셀/PDF → 지급·기사 확인 → 오입력 취소·미지급, 타 기사 URL 차단', async ({
  page,
}) => {
  const tag = `W5-${crypto.randomUUID()}`;
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, 'driver1');
  const first = await inputUse(page, { trips: 5, quantity: '1', date: '2026-09-15', extra: true, tag });
  expect(first.trips).toHaveLength(5);
  expect(first.charge_lines.find((line) => line.charge_type === 'BASE')!.computed_amount).toBe(300000);
  await login(page, 'driver2');
  const second = await inputUse(page, { trips: 2, quantity: '5', date: '2026-09-16', tag });
  expect(second.charge_lines.find((line) => line.charge_type === 'BASE')!.computed_amount).toBe(500000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, 'site');
  const proxy = await inputUse(page, { manager: true, trips: 1, quantity: '1', date: '2026-08-31', tag });
  expect(proxy.entered_as).toBe('PROXY');
  await page.goto(`/m/uses/${first.id}`);
  await page.getByLabel('보완 항목 1').selectOption('trip:2.destination');
  await page.getByLabel('보완 메시지 1').fill('2회차 하차장 확인');
  await page.getByRole('button', { name: '보완 요청 보내기' }).click();
  await expect(page.getByRole('status').filter({ hasText: '보완 요청을 전달했습니다' })).toBeVisible();
  await login(page, 'driver1');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/d/uses/${second.id}`);
  await expect(page.getByRole('alert').filter({ hasText: '찾을 수 없습니다' })).toBeVisible();
  expect((await page.request.get(`/api/uses/${second.id}`)).status()).toBe(404);
  await page.goto(`/d/uses/${first.id}`);
  await page.getByRole('button', { name: '2회차 하차장 확인 →' }).click();
  await page.getByLabel('2회차 도착', { exact: true }).fill('서울 동문');
  await page.getByRole('button', { name: '보완 후 재제출', exact: true }).click();
  await expect(page.getByText('담당자에게 제출 완료', { exact: true })).toBeVisible();
  await login(page, 'site');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/m/uses/${first.id}`);
  const toll = page.getByTestId('charge-TOLL');
  await toll.getByLabel('통행료 검수 결정').selectOption('HELD');
  await toll.getByLabel('통행료 검수 사유').fill('영수증 대기');
  await toll.getByRole('button', { name: '적용', exact: true }).click();
  await expect(toll.locator('span').filter({ hasText: /^보류$/ })).toBeVisible();
  for (const use of [first, second, proxy]) await approve(page, use);
  await login(page, 'settlement');
  const firstStatement = await settle(page, '한길 운송', [first, proxy], 660000, true);
  const secondStatement = await settle(page, '동서 운송', [second], 550000);
  await login(page, 'driver1');
  await page.setViewportSize({ width: 360, height: 800 });
  await driverStatement(page, firstStatement.no, '지급 완료');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await page.request.get(`/api/statements/${secondStatement.id}/export.pdf`)).status()).toBe(404);
  await login(page, 'driver2');
  await driverStatement(page, secondStatement.no, '지급 완료');
  await login(page, 'settlement');
  await page.goto(`/m/statements/${firstStatement.id}`);
  await page.getByRole('button', { name: '오입력 취소', exact: true }).click();
  await page.getByLabel('오입력 취소 사유').fill('지급일 오입력 테스트');
  await page.getByRole('button', { name: '기록 취소 확인' }).click();
  await expect(page.getByText('미지급', { exact: true })).toBeVisible();
  const after = (await (await page.request.get(`/api/statements/${firstStatement.id}`)).json()).data;
  expect(after.payments).toHaveLength(1);
  expect(after.payments[0].voided_at).toBeTruthy();
  await login(page, 'driver1');
  await driverStatement(page, firstStatement.no, '미지급');
});

test('360px 가져오기: 자동 매핑·프리셋·오류 다운로드·임시저장·같은 파일 재업로드 0건', async ({ page }) => {
  await login(page, 'admin');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/m/import');
  const tag = crypto.randomUUID();
  const buffer = Buffer.from(
    `사용일,현장,기사,차량번호,운송사,출발지,도착지,과금단위,운행횟수,단가,비고\n2026-09-15,서울 현장,김기사,서울80가1001,한길 운송,창고,현장,일대,5,300000,${tag}\n잘못된날짜,서울 현장,김기사,서울80가1001,한길 운송,창고,현장,일대,1,300000,오류\n`,
  );
  const file = { name: 'W5-브라우저.csv', mimeType: 'text/csv', buffer };
  await page.getByLabel('가져올 파일').setInputFiles(file);
  await expect(page.getByLabel('사용일 열')).toHaveValue('0');
  await page.getByLabel('매핑 이름').fill('W5 월간 가져오기');
  await page.getByRole('button', { name: '매핑 저장', exact: true }).click();
  await expect(page.getByText('매핑을 저장했습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '미리보기 검증' }).click();
  await expect(page.getByText('유효 1건 · 오류 1건 · 건너뜀 0건 · 등록 0건')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '오류 행 엑셀 다운로드' }).click();
  expect((await download).suggestedFilename()).toBe('import-errors.xlsx');
  await page.getByRole('button', { name: '유효 행 임시저장' }).click();
  await expect(page.getByText('유효 1건 · 오류 1건 · 건너뜀 0건 · 등록 1건')).toBeVisible();
  const detail = page.getByRole('link', { name: '사용 상세', exact: true });
  const id = (await detail.getAttribute('href'))!.split('/').pop();
  const use = (await (await page.request.get(`/api/uses/${id}`)).json()).data;
  expect(use.review_status).toBe('DRAFT');
  expect(use.entered_as).toBe('PROXY');
  expect(use.trips).toHaveLength(5);
  await page.getByLabel('가져올 파일').setInputFiles(file);
  await expect(page.getByRole('button', { name: '미리보기 검증' })).toBeEnabled();
  await page.getByRole('button', { name: '미리보기 검증' }).click();
  await expect(page.getByText('유효 0건 · 오류 1건 · 건너뜀 1건 · 등록 0건')).toBeVisible();
  await expect(page.getByRole('button', { name: '유효 행 임시저장' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
