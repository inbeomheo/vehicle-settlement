import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createJoinLink } from '../../src/server/services/driver-join';
import { createInvite } from '../../src/server/services/auth';

test('공용·미연결 개별 가입은 기존 사업자 거부를 미리 안내하고 연결 초대는 기존 정보로 가입한다', async ({
  page,
}) => {
  const database = createDatabase(process.env.DATABASE_URL!);
  let urls: string[];
  try {
    const s = await setupScenario(database.db);
    const shared = await createJoinLink(s.adminCtx, { project_ids: [s.project.id] });
    const fresh = await createInvite(s.adminCtx, {
      role: 'DRIVER',
      name: '신규 기사',
      project_ids: [s.project.id],
    });
    const linkedDriver = await s.f.driver();
    await s.f.affiliation(linkedDriver.id, s.payee.id);
    const linked = await createInvite(s.adminCtx, {
      role: 'DRIVER',
      name: '연결 기사',
      driver_id: linkedDriver.id,
      project_ids: [s.project.id],
    });
    urls = [shared.join_url, fresh.invite_url, linked.invite_url].map((url) => new URL(url).pathname);
  } finally {
    await database.pool.end();
  }
  for (const url of urls!.slice(0, 2)) {
    await page.goto(url);
    await expect(
      page.getByText(
        '같은 사업자로 이미 등록된 차량이 있으면 관리자에게 기사 추가(개별 초대)를 요청해 주세요.',
      ),
    ).toBeVisible();
    await expect(page.getByText('이미 등록된 사업자번호는 기존 상호를 사용합니다.')).toHaveCount(0);
  }
  await page.goto(urls![2]);
  await expect(page.getByText('관리자가 연결한 기사·사업자 정보로 가입합니다.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '사업자번호' })).toHaveCount(0);
});
