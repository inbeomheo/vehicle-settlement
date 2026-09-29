import path from 'node:path';
import { connect, verifyDatabase } from './backup-common';
async function main() {
  const { pool, client } = await connect();
  try {
    console.log(
      JSON.stringify({
        result: '통과',
        ...(await verifyDatabase(client, path.resolve(process.env.STORAGE_DIR ?? 'storage'))),
      }),
    );
  } catch (error) {
    console.error('복구 검증 실패:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((error) => {
  console.error('복구 검증 실패:', error.message);
  process.exitCode = 1;
});
