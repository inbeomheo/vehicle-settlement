import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';

for (const width of [360, 390, 1440]) {
  test(`8. 가져오기 계약 옵션·모든 오류·미확정 이력 접기 (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const db = createDatabase(process.env.DATABASE_URL!);
    let loginId: string;
    let csv: Buffer;
    try {
      const s = await setupScenario(db.db);
      loginId = s.admin.login_id;
      const headers = '사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,단가';
      const valid = `2026-09-15,${s.project.id},${s.driver.id},${s.vehicle.id},${s.payee.id},부산항,서울,일대,`;
      const invalid = `2026-02-30,없는현장,${s.driver.id},${s.vehicle.id},${s.payee.id},,,일대,-1`;
      csv = Buffer.from([headers, valid, invalid].join('\n'));
    } finally {
      await db.pool.end();
    }
    await page.request.post('/api/auth/login', { data: { login_id: loginId!, password: 'password1234' } });
    await page.goto('/m/import');
    await page
      .getByLabel('가져올 파일')
      .setInputFiles({ name: 'W8b-계약.csv', mimeType: 'text/csv', buffer: csv! });
    const contract = page.getByLabel('단가 열이 비어 있으면 계약 단가 적용');
    await expect(contract).toBeChecked();
    const history = page
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: '미리보기(미확정)' }) });
    await expect(history).toBeVisible();
    await expect(history).not.toHaveAttribute('open');
    await history.locator('summary').click();
    await expect(history.getByRole('button', { name: /W8b-계약.csv/ })).not.toContainText('성공 0');
    await page.getByRole('button', { name: '미리보기 검증' }).click();
    await expect(page.getByRole('status').filter({ hasText: '유효 1건 · 오류 1건' })).toBeVisible();
    await expect(page.getByText('계약 단가 적용: 300,000원')).toBeVisible();
    for (const field of ['사용일', '현장', '출발지', '도착지', '단가']) {
      await expect(page.locator('li').filter({ hasText: new RegExp(`^${field}:`) })).toBeVisible();
    }
    const sizes = await page
      .locator('input:not([type="checkbox"]), select, textarea')
      .evaluateAll((elements) =>
        elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
      );
    expect(sizes.every((size) => size >= 16)).toBe(true);
    const touchHeight = await contract
      .locator('..')
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(touchHeight).toBeGreaterThanOrEqual(44);
    await contract.uncheck();
    await expect(page.getByRole('button', { name: '유효 행 임시저장' })).toBeDisabled();
    await page.getByRole('button', { name: '미리보기 검증' }).click();
    await expect(page.getByText('단가 없음:', { exact: false })).toBeVisible();
    await contract.check();
    await page.getByRole('button', { name: '미리보기 검증' }).click();
    await expect(page.getByText('계약 단가 적용: 300,000원')).toBeVisible();
    await page.getByRole('button', { name: '유효 행 임시저장' }).click();
    await expect(page.getByRole('status').filter({ hasText: '1건을 임시저장' })).toBeVisible();
    await expect(page.getByRole('button', { name: /W8b-계약.csv.*완료.*성공 1/ })).toBeVisible();
  });
}
