import { expect, test, type Page } from '@playwright/test';

const users = [
  {
    id: 'user-a',
    name: '담당자 가',
    phone: '010-1111-1111',
    login_id: 'a',
    role: 'SETTLEMENT_MANAGER',
    all_projects: true,
    status: 'ACTIVE',
    driver_id: null,
    version: 1,
    assignments: [],
  },
  {
    id: 'user-b',
    name: '담당자 나',
    phone: '010-2222-2222',
    login_id: 'b',
    role: 'SETTLEMENT_MANAGER',
    all_projects: false,
    status: 'DISABLED',
    driver_id: null,
    version: 2,
    assignments: [],
  },
];
async function userRoutes(page: Page) {
  await page.route('**/api/admin/users', (route) => route.fulfill({ json: { data: users } }));
  await page.route('**/api/invites', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 'invite-a',
            name: '초대 대상 가',
            role: 'SITE_MANAGER',
            expires_at: '2099-01-01',
            used_at: null,
            revoked_at: null,
          },
        ],
      },
    }),
  );
}
test.beforeEach(async ({ page }) => {
  expect(
    (await page.request.post('/api/auth/login', { data: { login_id: 'admin', password: 'admin1234' } })).ok(),
  ).toBe(true);
});

test('편집 중 다른 사용자 선택 시 모든 입력과 저장 대상이 일치한다', async ({ page }) => {
  await userRoutes(page);
  let saved: unknown;
  await page.route('**/api/admin/users/user-b', async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { data: {} } });
  });
  await page.goto('/m/users');
  await page.getByRole('checkbox', { name: '꺼진 계정 1명 보기', exact: true }).check();
  await page
    .locator('article')
    .filter({ hasText: '담당자 가' })
    .getByRole('button', { name: '사용자 관리' })
    .click();
  await page.getByLabel('이름', { exact: true }).fill('저장하지 않은 이름');
  await page
    .locator('article')
    .filter({ hasText: '담당자 나' })
    .getByRole('button', { name: '사용자 관리' })
    .click();
  await expect(page.getByLabel('이름', { exact: true })).toHaveValue('담당자 나');
  await expect(page.getByLabel('연락처', { exact: true })).toHaveValue('010-2222-2222');
  await expect(page.getByLabel('계정 상태')).toHaveValue('DISABLED');
  await expect(page.getByLabel('모든 현장 접근')).not.toBeChecked();
  await page.getByRole('button', { name: '변경 저장' }).click();
  await expect
    .poll(() => saved)
    .toMatchObject({
      name: '담당자 나',
      phone: '010-2222-2222',
      status: 'DISABLED',
      all_projects: false,
      version: 2,
    });
});

test('초대 취소는 대상·건수·복구 불가 확인 및 포커스 복귀 후에만 요청한다', async ({ page }) => {
  await userRoutes(page);
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/invites/invite-a', async (route) => {
    requests++;
    await pending;
    await route.fulfill({ json: { data: {} } });
  });
  await page.goto('/m/users');
  const trigger = page.getByRole('button', { name: '초대 취소', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('초대 대상 가');
  await expect(dialog).toContainText('1건');
  await expect(dialog).toContainText('복구할 수 없습니다');
  expect(requests).toBe(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const confirm = dialog.getByRole('button', { name: '초대 취소', exact: true });
  await confirm.click();
  await expect(confirm).toBeDisabled();
  expect(requests).toBe(1);
  release();
  await expect(dialog).not.toBeVisible();
});

for (const failure of ['network', 'json']) {
  for (const [path, apiPath] of [
    ['/m/ledger', '**/api/ledger?**'],
    ['/m/statements', '**/api/statements?**'],
  ]) {
    test(`${path} ${failure} 오류는 한국어·재시도 표시, 빈 결과 숨김`, async ({ page }) => {
      await page.route(apiPath, (route) =>
        failure === 'network'
          ? route.abort('failed')
          : route.fulfill({ status: 200, contentType: 'text/html', body: '<html>bad gateway</html>' }),
      );
      await page.goto(path);
      await expect(page.locator('main').getByRole('alert')).toContainText(
        failure === 'network'
          ? '네트워크 연결을 확인하고 다시 시도하세요'
          : '서버 응답을 확인하지 못했습니다',
      );
      await expect(page.getByText('검색 결과가 없습니다.', { exact: true })).toHaveCount(0);
      await expect(page.getByText('전체 검색 결과 합계(0건)', { exact: true })).toHaveCount(0);
      await expect(page.getByText('작성된 명세가 없습니다. 새 정산에서 시작하세요.')).toHaveCount(0);
      await page.unroute(apiPath);
      await page.route(apiPath, (route) =>
        route.fulfill({
          json: {
            data: { rows: [], total: 0, page: 1, pageSize: 20, totals: { pageSum: 0, filteredSum: 0 } },
          },
        }),
      );
      await page.getByRole('button', { name: /다시 (시도|불러오기)/ }).click();
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
      await expect(
        page.getByText(
          path === '/m/ledger'
            ? '전체 검색 결과 합계(0건)'
            : '작성된 명세가 없습니다. 새 정산에서 시작하세요.',
          { exact: true },
        ),
      ).toBeVisible();
    });
  }
}

test('조건 변경 후 늦게 도착한 후보 응답을 표시하지 않는다', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/api/statements/candidates?**', async (route) => {
    calls++;
    if (calls === 1) await pending;
    await route.fulfill({ json: { data: { rows: [], unsubmitted_count: calls === 1 ? 99 : 0 } } });
  });
  await page.goto('/m/statements');
  await page.getByRole('button', { name: '새 정산', exact: true }).click();
  await page.getByLabel('거래처', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: '후보 조회', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByLabel('기간 시작').fill('2026-07-01');
  release();
  await expect(page.getByRole('button', { name: '후보 조회', exact: true })).toBeEnabled();
  await expect(page.getByText('조회된 미정산 비용이 없습니다.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '미제출 99건 보기' })).toHaveCount(0);
  await page.getByRole('button', { name: '후보 조회', exact: true }).click();
  await expect(page.getByText('조회된 미정산 비용이 없습니다.')).toBeVisible();
});

test('오래된 미리보기 삭제 확인은 파일명과 건수를 표시하고 취소할 수 있다', async ({ page }) => {
  const history = ['이전자료.xlsx', '이전자료2.csv'].map((file_name, index) => ({
    id: `preview-${index}`,
    file_name,
    created_at: '2026-01-01',
    created_by_name: '관리자',
    status: 'PREVIEW',
    stale_preview: true,
    summary: null,
  }));
  let requests = 0;
  await page.route('**/api/import', (route) => {
    if (route.request().method() === 'DELETE') {
      requests++;
      expect(route.request().postDataJSON()).toEqual({ ids: history.map((item) => item.id) });
    }
    return route.fulfill({
      json: { data: route.request().method() === 'DELETE' ? { deleted: 2 } : history },
    });
  });
  await page.goto('/m/import');
  await page.getByText('미리보기(미확정) 2건', { exact: true }).click();
  await page.getByRole('button', { name: '오래된 미확정 미리보기 삭제 (7일 이상)' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('2건');
  await expect(dialog).toContainText('이전자료.xlsx');
  await expect(dialog).toContainText('이전자료2.csv');
  await expect(dialog).toContainText('복구할 수 없습니다');
  await dialog.getByRole('button', { name: '돌아가기' }).click();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: '오래된 미확정 미리보기 삭제 (7일 이상)' }).click();
  await dialog.getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
});

test('정산 방향과 검수 목록은 키보드로 선택 가능한 필터 버튼이다', async ({ page }) => {
  for (const [path, first, second] of [
    ['/m/statements', '지급', '청구'],
    ['/m/review', '검수 대기', '보완 요청'],
  ]) {
    await page.goto(path);
    const selected = page.getByRole('button', { name: first, exact: true });
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await selected.focus();
    await page.keyboard.press('Tab');
    const next = page.getByRole('button', { name: second, exact: true });
    await expect(next).toBeFocused();
    await page.keyboard.press('Space');
    await expect(next).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toHaveAttribute('aria-pressed', 'false');
  }
});

test('같은 프레임의 중복 저장도 한 요청만 보내고 다른 사용자 선택을 잠근다', async ({ page }) => {
  await userRoutes(page);
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/users/user-a', async (route) => {
    requests++;
    await pending;
    await route.fulfill({ json: { data: {} } });
  });
  await page.goto('/m/users');
  await page.getByRole('checkbox', { name: '꺼진 계정 1명 보기', exact: true }).check();
  await page
    .locator('article')
    .filter({ hasText: '담당자 가' })
    .getByRole('button', { name: '사용자 관리' })
    .click();
  const save = page.getByRole('button', { name: '변경 저장' });
  await save.evaluate((element: HTMLButtonElement) => {
    element.form!.requestSubmit();
    element.form!.requestSubmit();
  });
  await expect(save).toBeDisabled();
  await expect(
    page.locator('article').filter({ hasText: '담당자 나' }).getByRole('button', { name: '사용자 관리' }),
  ).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  release();
  await expect(page.getByRole('status').filter({ hasText: '사용자 정보를 변경했습니다' })).toBeVisible();
  expect(requests).toBe(1);
});

test('사용자 ID·제목·보조 제목의 실제 렌더링 대비는 4.5 이상이다', async ({ page }) => {
  await userRoutes(page);
  await page.goto('/m/users');
  await expect(page.getByText('사용자 ID: user-a')).toBeVisible();
  const targets = [
    page.getByText('사용자 ID: user-a'),
    page.getByRole('heading', { name: '사용자 관리', exact: true }),
  ];
  for (const target of targets) {
    const ratio = await target.evaluate((element) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((value) => {
            const c = value / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      let parent: Element | null = element;
      while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)')
        parent = parent.parentElement;
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(parent ? getComputedStyle(parent).backgroundColor : '#ffffff');
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});

test('지급 기록 중복 제출 차단, 연결 실패 후 동일 키로 재시도', async ({ page }) => {
  const statement = {
    id: 'f8a-payment',
    direction: 'PAYABLE',
    status: 'CONFIRMED',
    statement_no: 'PAY-F8A',
    counterparty_snapshot: { name: '회귀 운송사' },
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    supply_total: 300000,
    tax_total: 30000,
    grand_total: 330000,
    version: 1,
    items: [],
    payments: [],
    payment_status: 'UNPAID',
    confirmed_at: '2026-09-29',
  };
  await page.route('**/api/statements/f8a-payment', (route) => route.fulfill({ json: { data: statement } }));
  const keys: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/statements/f8a-payment/payments', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    await pending;
    await route.abort('failed');
  });
  await page.goto('/m/statements/f8a-payment');
  const save = page.getByRole('button', { name: /원 지급 완료로 기록/ });
  await save.evaluate((element: HTMLButtonElement) => {
    element.form!.requestSubmit();
    element.form!.requestSubmit();
  });
  await expect(page.getByRole('button', { name: '처리 중…', exact: true })).toBeDisabled();
  await expect.poll(() => keys.length).toBe(1);
  release();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    '네트워크 연결을 확인하고 다시 시도하세요',
  );
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
});

for (const staleFailure of [false, true]) {
  test(`최신 후보 조회 완료 후 이전 ${staleFailure ? '오류' : '성공'} 응답을 무시한다`, async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route('**/api/statements/candidates?**', async (route) => {
      const first = ++requests === 1;
      if (first) await pending;
      await route.fulfill(
        first && staleFailure
          ? { status: 500, json: { error: { message: '이전 요청 오류' } } }
          : { json: { data: { rows: [], unsubmitted_count: first ? 99 : 2 } } },
      );
    });
    await page.goto('/m/statements');
    await page.getByRole('button', { name: '새 정산', exact: true }).click();
    await page.getByLabel('거래처', { exact: true }).selectOption({ index: 1 });
    const oldRequest = page.waitForRequest('**/api/statements/candidates?**');
    await page.getByRole('button', { name: '후보 조회', exact: true }).click();
    const oldUrl = (await oldRequest).url();
    await page.getByLabel('기간 시작').fill('2026-07-01');
    await page.getByRole('button', { name: '후보 조회', exact: true }).click();
    await expect(page.getByRole('button', { name: '미제출 2건 보기' })).toBeVisible();
    const response = page.waitForResponse(oldUrl);
    release();
    await (await response).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect(page.getByRole('button', { name: '미제출 2건 보기' })).toBeVisible();
    await expect(page.getByRole('button', { name: '미제출 99건 보기' })).toHaveCount(0);
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  });
}
