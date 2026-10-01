// 완성된 시연 DB에서 회사 정보만 잠시 비워 처음 사용 화면을 촬영하고 즉시 복원한다.
import pg from 'pg';
import { open, shot, login } from './lib.mjs';
const client = new pg.Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54375/vehicle_app',
});
await client.connect();
const { rows } = await client.query('SELECT * FROM company_settings');
const { browser, page } = await open({ mobile: false });
try {
  await client.query('DELETE FROM company_settings');
  await login(page, 'admin', 'admin1234');
  await page.getByText('시작 준비', { exact: true }).waitFor();
  await shot(page, '43-checklist');
} finally {
  try {
    for (const row of rows) {
      await client.query(
        'INSERT INTO company_settings SELECT * FROM json_populate_record(NULL::company_settings, $1::json)',
        [JSON.stringify(row)],
      );
    }
  } finally {
    await client.end();
    await browser.close();
  }
}
