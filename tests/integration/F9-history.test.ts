import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, updateUse, getUse } from '../../src/server/services/uses';
import { createEvidence, uploadEvidence, downloadEvidence } from '../../src/server/services/evidence';
import { queryAudit } from '../../src/server/services/audit-query';
const database = testDatabase();
it('기사 변경 전 제출본·증빙·감사 정보는 새 기사에게 노출되지 않는다', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.adminCtx, { ...s.input, notes: 'PREVIOUS_DRIVER_SECRET' });
  const bytes = Buffer.from('%PDF-test');
  const file = await createEvidence(s.driverCtx, use.id, {
    client_upload_id: randomUUID(),
    kind: 'CONFIRMATION',
    original_name: 'PREVIOUS_DRIVER_SECRET.pdf',
    mime: 'application/pdf',
    size: bytes.length,
  });
  await uploadEvidence(s.driverCtx, file.id, bytes, 'application/pdf');
  use = await getUse(s.driverCtx, use.id);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  const driver = await s.f.driver();
  await s.f.affiliation(driver.id, s.payee.id);
  const user = await s.f.user({ role: 'DRIVER', driver_id: driver.id });
  await s.f.assignment(user.id, s.project.id);
  const ctx = s.f.context(user);
  use = await updateUse(s.adminCtx, use.id, {
    version: use.version,
    driver_id: driver.id,
    notes: '현재 기사 메모',
  });
  const detail = await getUse(ctx, use.id);
  expect(JSON.stringify(detail)).not.toContain('PREVIOUS_DRIVER_SECRET');
  expect(detail.revisions.every((r) => r.snapshot.driver_id === driver.id)).toBe(true);
  await expect(downloadEvidence(ctx, file.id)).rejects.toMatchObject({ status: 404 });
  await expect(queryAudit(ctx, { use_id: use.id })).rejects.toMatchObject({ status: 403 });
  expect(JSON.stringify(await getUse(s.adminCtx, use.id))).toContain('PREVIOUS_DRIVER_SECRET');
  await expect(getUse(s.driverCtx, use.id)).rejects.toMatchObject({ status: 404 });
});
it('제출 이력이 없는 이전 기사 증빙도 수정 응답·메타 재생에서 숨긴다', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.adminCtx, s.input);
  const input = {
    client_upload_id: randomUUID(),
    kind: 'CONFIRMATION' as const,
    text_value: '이전 기사 개인 확인서',
  };
  await createEvidence(s.driverCtx, use.id, input);
  use = await getUse(s.adminCtx, use.id);
  const driver = await s.f.driver();
  await s.f.affiliation(driver.id, s.payee.id);
  const user = await s.f.user({ role: 'DRIVER', driver_id: driver.id });
  await s.f.assignment(user.id, s.project.id);
  const ctx = s.f.context(user);
  use = await updateUse(s.adminCtx, use.id, { version: use.version, driver_id: driver.id });
  expect(use.revisions).toHaveLength(0);
  expect((await getUse(ctx, use.id)).evidence).toHaveLength(0);
  const updated = await updateUse(ctx, use.id, { version: use.version, notes: '새 기사 비고' });
  expect(updated.evidence).toHaveLength(0);
  await expect(createEvidence(ctx, use.id, input)).rejects.toMatchObject({ status: 404 });
});
