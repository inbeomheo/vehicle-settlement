import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse, getUse, updateUse, approveUse } from '../../src/server/services/uses';
import { createEvidence, uploadEvidence } from '../../src/server/services/evidence';

const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(async () => database.pool.end());
test.use({ viewport: { width: 390, height: 844 } });
test('기사 변경 후 파일은 숨기고 제한 안내와 기존 증빙을 이용한 제출·읽기 전용 상세를 제공', async ({
  page,
}) => {
  const s = await setupScenario(database.db, { evidence_policy: 'PHOTO_REQUIRED' });
  let use = await createUse(s.adminCtx, { ...s.input, cargo_desc: '운반 자재' });
  const bytes = Buffer.from('%PDF-OLD_DRIVER_PRIVATE');
  const file = await createEvidence(s.adminCtx, use.id, {
    client_upload_id: randomUUID(),
    kind: 'CONFIRMATION',
    original_name: '이전기사_비공개.pdf',
    mime: 'application/pdf',
    size: bytes.length,
  });
  await uploadEvidence(s.adminCtx, file.id, bytes, 'application/pdf');
  const next = await s.f.driver();
  await s.f.affiliation(next.id, s.payee.id);
  const user = await s.f.user({ role: 'DRIVER', driver_id: next.id });
  await s.f.assignment(user.id, s.project.id);
  use = await getUse(s.adminCtx, use.id);
  await updateUse(s.adminCtx, use.id, { version: use.version, driver_id: next.id });
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { login_id: user.login_id, password: 'password1234' },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/d/uses/${use.id}`);
  const notice = page.getByText('증빙 1건은 담당자만 볼 수 있습니다. 사용 건의 제출·정산 근거로 보관됩니다.');
  await expect(notice).toBeVisible();
  await expect(page.getByText('이전기사_비공개.pdf')).toHaveCount(0);
  expect((await page.request.get(`/api/evidence/${file.id}/file`)).status()).toBe(404);
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.getByText('담당자에게 제출 완료', { exact: true })).toBeVisible();
  use = await getUse(s.adminCtx, use.id);
  expect(use.review_status).toBe('SUBMITTED');
  await approveUse(s.adminCtx, use.id, { version: use.version });
  await page.reload();
  await expect(notice).toBeVisible();
  await expect(page.getByText('이전기사_비공개.pdf')).toHaveCount(0);
  await expect(page.getByText('첨부된 증빙이 없습니다.', { exact: true })).toHaveCount(0);
  await expect(page.locator('input,select,textarea')).toHaveCount(0);
});
