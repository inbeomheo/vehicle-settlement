import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { extractPdfText } from '../helpers/pdf';
import { callRoute } from '../helpers/routes';
import { GET as directoryRoute } from '../../src/app/api/drivers/route';
import { saveMaster, listMaster } from '../../src/server/services/admin';
import { getDriverProfile, updateDriverProfile } from '../../src/server/services/driver-profiles';
import { createJoinLink, registerDriver } from '../../src/server/services/driver-join';
import { createInvite } from '../../src/server/services/auth';
import { getLookups } from '../../src/server/services/lookups';
import { exportSummaryTrade } from '../../src/server/services/summary-trade-export';
import { createUse, submitUse, approveUse } from '../../src/server/services/uses';
import { createStatement, confirmStatement } from '../../src/server/services/statements';
import { statementExportModel } from '../../src/server/export/statement-model';
import { renderStatementPdf } from '../../src/server/export/statement-pdf';
import { renderStatementXlsx } from '../../src/server/export/statement-xlsx';
import { companySettings, users } from '../../src/server/db/schema';

const database = testDatabase();
const details = {
  representative_name: '시연 대표',
  address: '시연시 시험로 123',
  business_type: '운수',
  business_item: '화물',
};
const period = { from: '2026-09-01', to: '2026-09-30' };
let serial = 0;
function registration() {
  const n = String(++serial).padStart(4, '0');
  return {
    client_request_id: randomUUID(),
    login_id: randomUUID(),
    password: 'password1234',
    profile: {
      name: '시연 기사',
      phone: `0105555${n}`,
      business_name: `시연사업${n}`,
      biz_no: `900-00-0${n}`,
      plate_no: `시연80아${n}`,
      vehicle_type: '카고',
      tonnage: '8',
      ...details,
    },
  };
}

it('마이그레이션은 nullable text와 길이 제약을 추가한다', async () => {
  const { pool } = database();
  const columns = await pool.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='counterparties' AND column_name=ANY($1)",
    [Object.keys(details)],
  );
  expect(columns.rows).toHaveLength(4);
  expect(columns.rows.every((c) => c.data_type === 'text' && c.is_nullable === 'YES')).toBe(true);
  const s = await setupScenario(database().db);
  for (const [field, max] of [
    ['representative_name', 200],
    ['address', 500],
    ['business_type', 100],
    ['business_item', 100],
  ] as const) {
    await expect(
      pool.query(`UPDATE counterparties SET ${field}=$1 WHERE id=$2`, ['가'.repeat(max + 1), s.payee.id]),
    ).rejects.toMatchObject({ code: '23514' });
  }
});

it('관리자 저장·빈값 삭제·길이 검증 및 선택 목록 개인정보 제외', async () => {
  const s = await setupScenario(database().db);
  expect(await saveMaster(s.adminCtx, 'counterparties', details, s.payee.id)).toMatchObject(details);
  await database().db.delete(companySettings);
  const company = await saveMaster(s.adminCtx, 'company', {
    name: '시연 회사',
    representative: '시연 회사대표',
    address: '시연 회사주소',
    business_type: '건설',
    business_item: '토목',
    default_tax_mode: 'VAT_EXCLUDED',
  });
  expect(company).toMatchObject({ business_type: '건설', business_item: '토목' });
  for (const role of ['SITE_MANAGER', 'SETTLEMENT_MANAGER'] as const) {
    const user = await s.f.user({ role });
    await s.f.assignment(user.id, s.project.id);
    const ctx = s.f.context(user);
    await expect(saveMaster(ctx, 'counterparties', details, s.payee.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    if (role === 'SETTLEMENT_MANAGER')
      expect((await listMaster(ctx, 'counterparties')).find((p) => p.id === s.payee.id)).toMatchObject(
        details,
      );
    const token = (await s.f.session(user.id)).token;
    const response = await callRoute(database().db, directoryRoute, { token, path: '/api/drivers' });
    const body = await response.json();
    if (role === 'SITE_MANAGER') {
      expect(JSON.stringify(body)).not.toContain(details.representative_name);
      expect(JSON.stringify(body)).not.toContain(details.address);
    } else expect(body.data.find((p: { id: string }) => p.id === s.driverUser.id)).toMatchObject(details);
    for (const party of (await getLookups(ctx)).counterparties)
      for (const key of Object.keys(details)) expect(party).not.toHaveProperty(key);
  }
  for (const party of (await getLookups(s.driverCtx)).counterparties)
    expect(party).not.toHaveProperty('address');
  await expect(
    saveMaster(s.adminCtx, 'counterparties', { address: '가'.repeat(501) }, s.payee.id),
  ).rejects.toThrow();
  expect(await saveMaster(s.adminCtx, 'counterparties', { address: '  ' }, s.payee.id)).toMatchObject({
    address: null,
  });
});

it.each([false, true])('새 사업자 가입과 본인/관리자 수정·공유 보호 (개별초대 %s)', async (individual) => {
  const s = await setupScenario(database().db);
  const link = individual
    ? await createInvite(s.adminCtx, { role: 'DRIVER', name: '시연 초대', project_ids: [s.project.id] })
    : await createJoinLink(s.adminCtx, { project_ids: [s.project.id] });
  const url = 'join_url' in link ? link.join_url : link.invite_url;
  const input = registration();
  const registered = await registerDriver(
    database().db,
    randomUUID(),
    new URL(url).pathname.split('/').at(-1)!,
    input,
    individual,
  );
  const [user] = await database().db.select().from(users).where(eq(users.id, registered.user.id));
  const ctx = s.f.context(user);
  const before = await getDriverProfile(ctx, user.id);
  expect(before).toMatchObject({ ...details, business_details_editable: true });
  const changed = await updateDriverProfile(ctx, user.id, {
    ...input.profile,
    address: '새 시연주소',
    version: before.version,
  });
  expect(changed).toMatchObject({ address: '새 시연주소' });
  const party = (await listMaster(s.adminCtx, 'counterparties')).find(
    (p) => p.biz_no === input.profile.biz_no,
  )!;
  const second = await s.f.driver({ active: false });
  await s.f.affiliation(second.id, String(party.id));
  expect(await getDriverProfile(ctx, user.id)).toMatchObject({ business_details_editable: false });
  await expect(
    updateDriverProfile(ctx, user.id, { ...input.profile, address: '변조주소', version: changed.version }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  const {
    representative_name: _r,
    address: _a,
    business_type: _t,
    business_item: _i,
    ...legacy
  } = input.profile;
  void [_r, _a, _t, _i];
  const unchanged = await updateDriverProfile(ctx, user.id, { ...legacy, version: changed.version });
  expect(unchanged.address).toBe('새 시연주소');
  const adminEdit = await updateDriverProfile(s.adminCtx, user.id, {
    ...input.profile,
    address: '관리자 수정주소',
    version: unchanged.version,
  });
  // 기사 정보 저장은 관리자도 공유 원장을 수정하지 않는다 (H-FIX).
  expect(adminEdit.address).toBe('새 시연주소');
  await saveMaster(s.adminCtx, 'counterparties', { address: '관리자 수정주소' }, String(party.id));
  expect((await getDriverProfile(ctx, user.id)).address).toBe('관리자 수정주소');
});

it('단독 CARRIER도 기사에게 사업자 상세 수정 권한이 없고 지정 가입은 필드 변조를 거부한다', async () => {
  const s = await setupScenario(database().db);
  await saveMaster(s.adminCtx, 'counterparties', { ...details, biz_no: '999-99-99999' }, s.payee.id);
  const info = await getDriverProfile(s.driverCtx, s.driverUser.id);
  expect(info).toMatchObject({ ...details, business_details_editable: false });
  await expect(
    updateDriverProfile(s.driverCtx, s.driverUser.id, {
      ...registration().profile,
      business_name: s.payee.name,
      biz_no: '999-99-99999',
      address: '변조주소',
      version: 1,
    }),
  ).rejects.toThrow();
  const link = await createJoinLink(s.adminCtx, { project_ids: [s.project.id], counterparty_id: s.payee.id });
  const input = registration();
  const { business_name: _b, biz_no: _n, ...profile } = input.profile;
  void [_b, _n];
  await expect(
    registerDriver(database().db, randomUUID(), new URL(link.join_url).pathname.split('/').at(-1)!, {
      ...input,
      profile,
    }),
  ).rejects.toThrow('지정된 소속');
  const fresh = registration();
  const created = await createJoinLink(s.adminCtx, {
    project_ids: [s.project.id],
    new_business: { name: fresh.profile.business_name, biz_no: fresh.profile.biz_no, ...details },
  });
  expect(
    (await listMaster(s.adminCtx, 'counterparties')).find((p) => p.id === created.counterparty_id),
  ).toMatchObject(details);
});

it('거래명세표·정산 XLSX/PDF 머리에 양쪽 정보를 출력하고 확정 스냅샷을 보존한다', async () => {
  const s = await setupScenario(database().db);
  await saveMaster(s.adminCtx, 'counterparties', { ...details, biz_no: '888-88-88888' }, s.payee.id);
  await database().db.delete(companySettings);
  await saveMaster(s.adminCtx, 'company', {
    name: '시연 회사',
    representative: '시연 회사대표',
    address: '시연 회사주소',
    business_type: '건설',
    business_item: '토목',
    default_tax_mode: 'VAT_EXCLUDED',
  });
  let use = await createUse(s.adminCtx, { ...s.input, quantity: '1' });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  const query = { ...period, payee_counterparty_id: s.payee.id, project_id: s.project.id };
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await exportSummaryTrade(s.adminCtx, query)).bytes as unknown as ExcelJS.Buffer);
  const sheet = book.worksheets[0];
  expect(sheet.getCell('C6').text).toBe(details.representative_name);
  expect(sheet.getCell('C7').text).toBe(details.address);
  expect(sheet.getCell('C8').text).toBe('운수 / 화물');
  expect(sheet.getCell('F8').text).toBe('건설 / 토목');
  const site = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(site.id, s.project.id);
  const hidden = new ExcelJS.Workbook();
  await hidden.xlsx.load(
    (await exportSummaryTrade(s.f.context(site), query)).bytes as unknown as ExcelJS.Buffer,
  );
  for (const secret of [details.representative_name, details.address, '시연 회사대표', '시연 회사주소'])
    expect(JSON.stringify(hidden.model)).not.toContain(secret);
  const draft = await createStatement(s.adminCtx, {
    client_request_id: randomUUID(),
    direction: 'PAYABLE',
    counterparty_id: s.payee.id,
    period_start: period.from,
    period_end: period.to,
    items: use.charge_lines.map((l) => ({ charge_line_id: l.id, inclusion: 'INCLUDED' })),
  });
  await confirmStatement(s.adminCtx, draft.id, {
    version: draft.version,
    confirmation_token: draft.confirmation_token!,
  });
  await saveMaster(s.adminCtx, 'counterparties', { address: '나중 주소' }, s.payee.id);
  const model = await statementExportModel(s.adminCtx, draft.id);
  expect(model.counterparty).toMatchObject(details);
  const xlsx = new ExcelJS.Workbook();
  await xlsx.xlsx.load((await renderStatementXlsx(model)) as unknown as ExcelJS.Buffer);
  const pdf = extractPdfText(await renderStatementPdf(model)).replace(/\s+/g, ' ');
  for (const value of [...Object.values(details), '시연 회사대표', '시연 회사주소', '건설', '토목']) {
    expect(JSON.stringify(xlsx.model)).toContain(value);
    expect(pdf).toContain(value);
  }
});
