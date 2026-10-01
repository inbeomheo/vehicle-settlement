import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { writeFileSync } from 'node:fs';
import { setupScenario } from '../helpers/factories';
import { extractPdfText } from '../helpers/pdf';
import { createUse, submitUse, approveUse } from '../../src/server/services/uses';
import { renderUseReport } from '../../src/server/services/use-report';
const database = testDatabase();

it('보고서에는 두 서명 빈 칸·전자 확인 정보가 있고 일반 운행은 한 장이다', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.driverCtx, s.input);
  for (const approved of [false, true]) {
    if (approved) {
      use = await submitUse(s.driverCtx, use.id, { version: use.version });
      use = await approveUse(s.adminCtx, use.id, { version: use.version });
    }
    const pdf = await renderUseReport(s.driverCtx, use.id);
    const text = extractPdfText(pdf);
    expect(text).toContain('기사 (서명)');
    expect(text).toContain('담당자 확인 (서명)');
    expect(text).toContain(approved ? s.admin.name : '승인 전');
    expect(text).toContain('전자 확인:');
    expect(pdf.toString('latin1')).toMatch(/\/Type \/Pages\s+\/Count 1/);
    writeFileSync(`/private/tmp/fix-req-report-${approved ? 'approved' : 'draft'}.pdf`, pdf);
  }
  const longName = '긴승인자이름'.repeat(30);
  await database().pool.query('UPDATE users SET name=$1 WHERE id=$2', [longName, s.admin.id]);
  const longPdf = await renderUseReport(s.driverCtx, use.id);
  expect(extractPdfText(longPdf).replace(/\s+/g, '')).toContain(longName);
  expect(longPdf.toString('latin1')).toMatch(/\/Type \/Pages\s+\/Count 1/);
  writeFileSync('/private/tmp/fix-req-report-long-name.pdf', longPdf);
});
