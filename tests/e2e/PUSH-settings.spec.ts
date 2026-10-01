import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { pushSubscriptions } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';

const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(async () => database.pool.end());
test.use({ viewport: { width: 360, height: 800 } });
test.setTimeout(90000);

// Only the browser/provider boundary is replaced: permissions, SW activation,
// app requests, authentication, validation and PostgreSQL remain real.
async function mockPushProvider(page: Page) {
  await page.addInitScript(
    ({ publicKey }) => {
      const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`;
      function current() {
        const stored = sessionStorage.getItem('push-test-subscription');
        if (!stored) return null;
        const value = JSON.parse(stored);
        return {
          ...value,
          toJSON: () => value,
          unsubscribe: async () => {
            if (sessionStorage.getItem('push-test-unsubscribe-fails'))
              throw new Error('provider unavailable');
            sessionStorage.removeItem('push-test-subscription');
            return true;
          },
        };
      }
      PushManager.prototype.getSubscription = async () => current();
      PushManager.prototype.subscribe = async (options) => {
        if (!options?.userVisibleOnly || !options.applicationServerKey)
          throw new Error('permission required');
        sessionStorage.setItem(
          'push-test-subscription',
          JSON.stringify({
            endpoint,
            expirationTime: null,
            keys: { p256dh: publicKey, auth: 'AQEBAQEBAQEBAQEBAQEBAQ' },
          }),
        );
        return current();
      };
    },
    { publicKey: process.env.VAPID_PUBLIC_KEY! },
  );
}
async function login(page: Page, loginId: string, path: string) {
  expect(
    (
      await page.request.post('/api/auth/login', { data: { login_id: loginId, password: 'password1234' } })
    ).ok(),
  ).toBe(true);
  await page.goto(path);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const size of ['normal', 'xlarge']) {
  test(`기사 알림 허용·실제 구독 API·새로고침·끄기·로그아웃 (${size}, 360px)`, async ({ page, context }) => {
    const s = await setupScenario(database.db);
    await context.grantPermissions(['notifications'], {
      origin: `http://localhost:${process.env.PORT ?? 3153}`,
    });
    await mockPushProvider(page);
    await page.addInitScript((size) => localStorage.setItem('vehicle-text-size', size), size);
    await login(page, s.driverUser.login_id, '/d');
    const panel = page.getByRole('region', { name: '알림 설정' });
    await expect(panel.getByRole('button', { name: '알림 받기', exact: true })).toBeVisible();
    const request = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/push/subscriptions') && response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: '알림 받기', exact: true }).click();
    await expect(panel).toContainText('알림 받기 · 켜짐');
    expect((await request).status()).toBe(200);
    expect(
      await database.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.user_id, s.driverUser.id)),
    ).toHaveLength(1);
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`push-driver-${size}.png`), fullPage: true });
    expect(
      (await panel.getByRole('button', { name: '알림 끄기' }).boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await page.reload();
    await expect(panel.getByRole('button', { name: '알림 끄기' })).toBeVisible();
    await panel.getByRole('button', { name: '알림 끄기' }).click();
    await expect(panel).toContainText('알림 받기 · 꺼짐');
    expect(
      await database.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.user_id, s.driverUser.id)),
    ).toHaveLength(0);
    await panel.getByRole('button', { name: '알림 받기', exact: true }).click();
    await expect(panel).toContainText('알림 받기 · 켜짐');
    if (size === 'xlarge') {
      await page.evaluate(() => sessionStorage.setItem('push-test-unsubscribe-fails', '1'));
    }
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(
      await database.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.user_id, s.driverUser.id)),
    ).toHaveLength(0);
  });
}

test('담당자 메뉴 아래 설정, 권한 거절은 구독 요청 없음, 저장 오류 후 재시도', async ({ page, context }) => {
  const s = await setupScenario(database.db);
  await context.grantPermissions(['notifications'], {
    origin: `http://localhost:${process.env.PORT ?? 3153}`,
  });
  await mockPushProvider(page);
  await page.addInitScript(() => localStorage.setItem('vehicle-text-size', 'xlarge'));
  await login(page, s.admin.login_id, '/m');
  await page.getByRole('button', { name: '메뉴', exact: true }).click();
  const panel = page.locator('#manager-menu').getByRole('region', { name: '알림 설정' });
  await expect(panel.getByRole('button', { name: '알림 받기', exact: true })).toBeVisible();
  await page.evaluate(() => {
    Notification.requestPermission = async () => 'denied';
  });
  let posts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/push/subscriptions') && request.method() === 'POST') posts++;
  });
  await panel.getByRole('button', { name: '알림 받기', exact: true }).click();
  await expect(panel).toContainText('브라우저 설정에서 알림을 허용');
  expect(posts).toBe(0);
  await page.evaluate(() => {
    Notification.requestPermission = async () => 'granted';
  });
  await page.route('**/api/push/subscriptions', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '잠시 후 다시 시도해 주세요.' } } }),
  );
  await panel.getByRole('button', { name: '알림 받기', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('잠시 후 다시');
  await page.unroute('**/api/push/subscriptions');
  await panel.getByRole('button', { name: '알림 받기', exact: true }).click();
  await expect(panel).toContainText('알림 받기 · 켜짐');
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('push-manager.png') });
  await panel.getByRole('button', { name: '알림 끄기' }).click();
});
test('iPhone 홈 화면 추가 안내, 서버 미설정 안내, 미지원 브라우저 안내', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, '/d');
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone', configurable: true }),
  );
  await page.reload();
  const panel = page.getByRole('region', { name: '알림 설정' });
  await expect(panel).toContainText('홈 화면에 추가');
  await expect(panel.getByRole('button')).toHaveCount(0);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', { value: 'Chrome', configurable: true }),
  );
  await page.route('**/api/push', (route) =>
    route.fulfill({ json: { data: { enabled: false, publicKey: null } } }),
  );
  await page.reload();
  await expect(panel).toContainText('알림 서비스 준비 중');
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'PushManager');
  });
  await page.reload();
  await expect(panel).toContainText('알림을 지원하지 않습니다');
});
