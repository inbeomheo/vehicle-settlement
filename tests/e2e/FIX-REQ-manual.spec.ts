import { expect, test } from '@playwright/test';
import { extractPdfText } from '../helpers/pdf';
test('웹·PDF 설명서는 입력 순서·필수 항목·전액 1회 지급 안내가 일치한다', async ({ page }) => {
  await page.goto('/manual');
  const main = page.locator('main');
  await expect(main).toContainText('전액 지급을 마친 뒤 한 번만');
  await expect(main).not.toContainText('나눠 보냈으면 보낼 때마다');
  await expect(main).toContainText('차량 최대 적재');
  await expect(main).toContainText('소속 시작일');
  await expect(main).toContainText('담당자·적재용량');
  await expect(main).toContainText('프로젝트 → 운행일 → 담당자 → 적재용량 → 운송내역 → 금액 → 사진·증빙');
  const response = await page.request.get('/manual/vehicle-manual.pdf');
  expect(response.ok()).toBe(true);
  const text = extractPdfText(await response.body()).replace(/\s+/g, ' ');
  expect(text).toContain('전액 지급을 마친 뒤 한 번만');
  expect(text).toContain('적재용량');
  expect(text.indexOf('4 이번 운행 금액을 확인합니다')).toBeGreaterThan(-1);
  expect(text.indexOf('4 이번 운행 금액을 확인합니다')).toBeLessThan(
    text.indexOf('5 필요하면 인수증을 찍습니다'),
  );
  expect(text).not.toContain('운반 내용만 적습니다');
  expect(text).not.toContain('나눠 보냈으면 보낼 때마다');
});
