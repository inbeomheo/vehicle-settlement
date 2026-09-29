import { createDatabase, defaultDatabaseUrl } from '../src/server/db/client';
import { recalculateImportHashes } from '../src/server/services/import-rehash';

async function main() {
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    const result = await recalculateImportHashes(db, (entry) => console.warn(JSON.stringify(entry)));
    console.log(
      `가져오기 해시 재계산 완료: 갱신 ${result.updated}건, 동일 ${result.unchanged}건, 건너뜀 ${result.skipped}건`,
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('가져오기 해시 재계산 실패: DB 연결과 마이그레이션 상태를 확인하세요.');
  process.exitCode = 1;
});
