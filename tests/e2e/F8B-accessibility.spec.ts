import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { approveUse, createUse, getUse, requestFix, submitUse } from '../../src/server/services/uses';
import { submitDriverForm } from './submit-helper';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15000 });
test.afterAll(async () => database.pool.end());

async function login(page: Page, loginId: string, path: string) {
  await page.request.post('/api/auth/login', { data: { login_id: loginId, password: 'password1234' } });
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function failLocalWrites(page: Page) {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.assign(window, { failDraftWrites: true });
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'drafts' && Reflect.get(window, 'failDraftWrites')) {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
}

async function recoverLocalWrites(page: Page) {
  await page.evaluate(() => Reflect.set(window, 'failDraftWrites', false));
}

async function storedDrafts(page: Page) {
  return page.evaluate(async () => {
    const user = localStorage.getItem('vehicle-active-user');
    return new Promise<{ id: string; form: { trips: { origin: string }[] } }[]>((resolve, reject) => {
      const request = indexedDB.open(`vehicle-w2-${user}`, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const rows = db.transaction('drafts').objectStore('drafts').getAll();
        rows.onsuccess = () => {
          db.close();
          resolve(rows.result);
        };
        rows.onerror = () => reject(rows.error);
      };
    });
  });
}

for (const recovery of ['retry', 'autosave', 'save', 'submit'] as const) {
  test(`IndexedDB 실패 뒤 최신 입력으로 복구한다: ${recovery}`, async ({ page }) => {
    const s = await setupScenario(database.db);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
    const origin = page.getByLabel('1회차 출발', { exact: true });
    await expect(origin).toBeEnabled();
    await failLocalWrites(page);
    await origin.fill('저장 실패 입력');
    await page.getByLabel('1회차 도착', { exact: true }).fill('현장');
    await expect(page.getByText('휴대폰 저장 실패 — 다시 시도', { exact: true })).toBeVisible();
    // Periodic/pagehide writes must also handle rejection without poisoning the queue.
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await origin.fill('최신 입력');
    await recoverLocalWrites(page);
    if (recovery === 'retry') {
      await page.getByRole('button', { name: '휴대폰 저장 실패 — 다시 시도', exact: true }).click();
    } else if (recovery === 'save' || recovery === 'submit') {
      if (recovery === 'save') await page.getByRole('button', { name: '서버 저장', exact: true }).click();
      else await submitDriverForm(page);
    }
    if (recovery === 'submit') {
      await expect(page).toHaveURL(/\/d\/uses\/[\w-]+/);
      const id = new URL(page.url()).pathname.split('/').at(-1)!;
      const use = await getUse(s.driverCtx, id);
      expect(use.review_status).toBe('SUBMITTED');
      expect(use.trips[0].origin).toBe('최신 입력');
    } else {
      await expect.poll(async () => (await storedDrafts(page))[0]?.form.trips[0].origin).toBe('최신 입력');
      await expect(page.getByRole('status')).toHaveText(
        recovery === 'save' ? '작성 중 · 아직 안 보냄' : '휴대폰에만 저장됨',
      );
      await page.reload();
      await expect(origin).toHaveValue('최신 입력');
    }
    expect(pageErrors).toEqual([]);
  });
}

test('검증 오류와 보완 요청은 입력 설명에 연결되고 요약에서 키보드로 이동한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  let use = await createUse(s.driverCtx, s.input);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  use = await requestFix(s.adminCtx, use.id, {
    version: use.version,
    comment: '출발 재확인',
    fix_items: [{ target: 'trip:1.origin', message: '상세 출발지를 입력하세요' }],
  });
  await login(page, s.driverUser.login_id, `/d/uses/${use.id}`);
  const origin = page.getByLabel('1회차 출발', { exact: true });
  await expect(origin).toHaveAttribute('aria-invalid', 'true');
  await expect(origin).toHaveAccessibleDescription(/보완 요청: 상세 출발지를 입력하세요/);
  await origin.fill('');
  await submitDriverForm(page, '고쳐서 다시 보내기');
  await expect(origin).toBeFocused();
  await expect(origin).toHaveAccessibleDescription(/출발.*보완 요청/s);
  const summary = page.locator('#form-errors').getByRole('button', { name: /출발/ });
  await summary.focus();
  await summary.press('Enter');
  await expect(origin).toBeFocused();
  await expect(origin).toBeInViewport();
});

test('증빙 제출 오류를 사진 입력에 연결한다', async ({ page }) => {
  const s = await setupScenario(database.db, { evidence_policy: 'PHOTO_REQUIRED' });
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await page.getByLabel('1회차 출발', { exact: true }).fill('창고');
  await page.getByLabel('1회차 도착', { exact: true }).fill('현장');
  await submitDriverForm(page);
  await expect(page.getByLabel('카메라 촬영', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('카메라 촬영', { exact: true })).toHaveAccessibleDescription(
    /사진·인수증·계근표·확인서/,
  );
});

test('비용 묶음·증빙 보완 요청도 실제 입력의 설명으로 읽힌다', async ({ page }) => {
  const s = await setupScenario(database.db);
  let use = await createUse(s.driverCtx, s.input);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  use = await requestFix(s.adminCtx, use.id, {
    version: use.version,
    comment: '운임과 증빙 확인',
    fix_items: [
      { target: `charge:${use.charge_lines[0].id}`, message: '청구 기준을 다시 확인하세요' },
      { target: 'evidence', message: '현장 사진을 첨부하세요' },
    ],
  });
  await login(page, s.driverUser.login_id, `/d/uses/${use.id}`);
  await expect(page.getByLabel('청구 수량', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('청구 수량', { exact: true })).toHaveAccessibleDescription(
    /청구 기준을 다시 확인하세요/,
  );
  await expect(page.getByLabel('사진·파일 선택', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('사진·파일 선택', { exact: true })).toHaveAccessibleDescription(
    /현장 사진을 첨부하세요/,
  );
});

for (const action of ['save', 'submit'] as const) {
  test(`서버 실패 요약에 포커스하고 연속 실행을 차단한다: ${action}`, async ({ page }) => {
    const s = await setupScenario(database.db);
    await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
    await page.getByLabel('1회차 출발', { exact: true }).fill('창고');
    await page.getByLabel('1회차 도착', { exact: true }).fill('현장');
    let count = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(action === 'save' ? '**/api/uses' : '**/api/uses/*/submit', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      count++;
      await gate;
      await route.fulfill({
        status: 502,
        json: { error: { code: 'NETWORK_ERROR', message: 'Network request failed' } },
      });
    });
    const trigger = page.getByRole('button', {
      name: action === 'save' ? '서버 저장' : '담당자에게 보내기',
      exact: true,
    });
    await expect(trigger).toBeEnabled();
    // 제출은 확인 시트의 "보내기"가 실제 전송 버튼이다.
    const target =
      action === 'save'
        ? trigger
        : await (async () => {
            await trigger.click();
            const sheet = page.getByRole('dialog', { name: '이대로 보낼까요?' });
            await expect(sheet).toBeVisible();
            return sheet.getByRole('button', { name: '보내기', exact: true });
          })();
    await target.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    try {
      await expect(trigger).toBeDisabled();
      await expect.poll(() => count).toBe(1);
    } finally {
      release();
    }
    await expect(page.locator('#form-errors')).toBeFocused();
    await expect(page.locator('#form-errors')).toContainText('인터넷 연결');
    expect(count).toBe(1);
  });
}

test('복사 연속 클릭은 한 요청만 보내고 실패 요약에 포커스·한국어 오류를 표시한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const use = await createUse(s.driverCtx, s.input);
  await login(page, s.driverUser.login_id, `/d/uses/${use.id}`);
  const copy = page.getByRole('button', { name: '이전 운행 복사', exact: true });
  let count = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/uses/${use.id}`, async (route) => {
    count++;
    await gate;
    await route.fulfill({ status: 502, json: { error: { code: 'NETWORK_ERROR', message: 'fetch failed' } } });
  });
  await copy.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  try {
    await expect(copy).toBeDisabled();
    expect(count).toBeLessThanOrEqual(1);
  } finally {
    release();
  }
  await expect(page.locator('#form-errors')).toBeFocused();
  await expect(page.locator('#form-errors')).toContainText('인터넷 연결');
  await expect(page.locator('#form-errors')).not.toContainText('fetch failed');
  await expect(copy).toBeEnabled();
  expect(count).toBe(1);
  await page.unroute(`**/api/uses/${use.id}`);
  await copy.click();
  await expect(page).toHaveURL(/\/d\/new\?draft=/);
  expect(await storedDrafts(page)).toHaveLength(1);
});

for (const confirmation of ['cancel', 'approved', 'discard'] as const) {
  test(`인라인 확인창 진입·취소 포커스를 유지한다: ${confirmation}`, async ({ page }) => {
    const s = await setupScenario(database.db);
    let use = await createUse(s.driverCtx, s.input);
    if (confirmation === 'approved') {
      use = await submitUse(s.driverCtx, use.id, { version: use.version });
      use = await approveUse(s.adminCtx, use.id, { version: use.version });
    }
    await login(
      page,
      s.driverUser.login_id,
      confirmation === 'discard' ? `/d/new?project=${s.project.id}` : `/d/uses/${use.id}`,
    );
    const name = { cancel: '작성중 운행 취소', approved: '수정하기', discard: '기기 초안 폐기' }[
      confirmation
    ];
    const trigger = page.getByRole('button', { name, exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await trigger.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button').first()).toBeFocused();
    await dialog
      .getByRole('button', { name: confirmation === 'approved' ? '돌아가기' : '계속 작성', exact: true })
      .click();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await dialog.getByRole('button').first().press('Escape');
    await expect(trigger).toBeFocused();
  });
}

test('계약·예상 금액·조회 실패는 정중한 실시간 알림 영역에서 갱신한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  const region = page.locator('[aria-live="polite"]').filter({ hasText: '기본운임' });
  await expect(region).toContainText('300,000원');
  await expect(region).toHaveAttribute('aria-atomic', 'true');
  await page.getByLabel('청구 수량', { exact: true }).fill('2');
  await expect(region).toContainText('600,000원');
  await page.route('**/api/rates/lookup?**', (route) => route.abort());
  await page.getByLabel('요금 기준', { exact: true }).selectOption('PER_HOUR');
  await expect(region).toContainText('계약을 확인할 수 없습니다');
});

test('숨긴 사진 입력에 탭으로 접근하면 보이는 레이블에 포커스 테두리를 표시한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  // 증빙 영역은 큰 사진 추가 영역 → 카메라 바로 촬영 순서로 탭 이동한다.
  await expect(page.getByLabel('1회차 출발', { exact: true })).toBeVisible();
  await expect(page.getByLabel('사진·파일 선택', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '직전 회차 복사', exact: true }).focus();
  for (const name of ['사진·파일 선택', '카메라 촬영']) {
    await page.keyboard.press('Tab');
    const input = page.getByLabel(name, { exact: true });
    await expect(input).toBeFocused();
    const label = input.locator('..');
    await expect
      .poll(() =>
        label.evaluate((el) => {
          const style = getComputedStyle(el);
          return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
        }),
      )
      .toBe(true);
  }
});

async function textContrast(locator: Locator) {
  return locator.evaluate((element) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    function rgb(color: string) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    }
    const foreground = rgb(getComputedStyle(element).color);
    let background = [255, 255, 255, 255];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = rgb(getComputedStyle(node).backgroundColor);
      if (color[3] === 255) {
        background = color;
        break;
      }
    }
    function luminance(color: number[]) {
      const linear = color.slice(0, 3).map((value) => {
        const v = value / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  });
}

test('기사 화면 보조 텍스트는 실제 배경에서 명암비 4.5 이상이다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const use = await createUse(s.driverCtx, s.input);
  await login(page, s.driverUser.login_id, '/d');
  // 목록 카드는 사용번호 대신 현장·경로를 보여 준다. 보조 텍스트 대비는 아래에서 모두 검사한다.
  void use.use_no;
  for (const path of ['/d', `/d/uses/${use.id}`]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const muted = page.locator('[class*="text-slate-4"], [class*="text-slate-5"], [class*="text-slate-6"]');
    for (const item of await muted.all()) {
      if (await item.isVisible())
        expect(await textContrast(item), (await item.textContent()) ?? '').toBeGreaterThanOrEqual(4.5);
    }
  }
});
