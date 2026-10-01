import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';

test.setTimeout(120000);
const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(() => database.pool.end());
test('새 워커 안내에서 초안 저장 후 전환하고 한 번만 새로고침한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await page.request.post('/api/auth/login', {
    data: { login_id: s.driverUser.login_id, password: 'password1234' },
  });
  await page.goto('/d/new');
  await page.getByLabel('1회차 출발', { exact: true }).fill('업데이트 전 초안');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const original = await readFile('public/sw-version.js', 'utf8');
  const version = `ops-${Date.now()}`;
  try {
    await writeFile('public/sw-version.js', `self.VEHICLE_SHELL_VERSION = '${version}';\n`);
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update();
    });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
    await expect(page.getByText('새 버전이 있어요', { exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.addEventListener(
        'vehicle-flush-drafts',
        (event) => {
          (event as CustomEvent<{ waitUntil: (promise: Promise<void>) => void }>).detail.waitUntil(
            Promise.reject(new Error('테스트 저장 실패')),
          );
        },
        { once: true },
      );
    });
    await page.getByRole('button', { name: '초안 저장 후 새로고침', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '테스트 저장 실패' })).toBeVisible();
    expect(
      await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    ).toBe(true);
    await page.getByLabel('1회차 출발', { exact: true }).fill('새로고침 직전 입력');
    let navigations = 0;
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++;
    });
    await page.getByRole('button', { name: '초안 저장 후 새로고침', exact: true }).click();
    await expect(page.getByLabel('1회차 출발', { exact: true })).toHaveValue('새로고침 직전 입력');
    await expect.poll(() => navigations).toBe(1);
    await page.waitForFunction(
      async (version) => (await caches.keys()).includes(`vehicle-shell-w2-${version}`),
      version,
    );
    await expect(page.getByText('새 버전이 있어요', { exact: true })).toHaveCount(0);
    expect(navigations).toBe(1);
  } finally {
    await writeFile('public/sw-version.js', original);
  }
});
