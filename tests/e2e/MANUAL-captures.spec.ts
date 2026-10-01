import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`설명서 최신 기능 캡처와 원본 링크·레이아웃 (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/manual');
    for (const alt of [
      '담당자·적재용량 입력',
      '계약 단가 없는 운행 금액 입력',
      '기사 홈 목록 탭과 필터',
      '알림 받기 설정',
      '운행 결재 목록',
      '운행 보고서 PDF',
      '현장 만들기와 기사 자동 배정',
      '기사관리',
      '기사 가입 링크 만들기',
      '기사 가입 화면',
    ]) {
      const image = page.getByRole('img', { name: alt, exact: true });
      await expect(image).toHaveCount(1);
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
        .toBe(true);
    }
    for (const image of await page.locator('main img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
        .toBe(true);
      const src = await image.getAttribute('src');
      const file = src!.split('/').at(-1)!;
      const original = readFileSync(`docs/manual/img/${file}`);
      expect(readFileSync(`public/manual/${file}`).equals(original)).toBe(true);
      if (!file.includes('pdf') && !file.includes('report')) {
        expect([780, 1440]).toContain(original.readUInt32BE(16));
        expect([1688, 900]).toContain(original.readUInt32BE(20));
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('main')).not.toContainText(/demo1234|admin1234|driver1/);
  });
}
