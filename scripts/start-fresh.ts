import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, defaultDatabaseUrl } from '../src/server/db/client';
import { passwordResets, users } from '../src/server/db/schema';
import { hashPassword, hashToken, newToken } from '../src/server/auth/password';

/**
 * 실제 사용 시작: 시연 데이터를 모두 지우고 관리자 계정 하나만 만든다.
 * 관리자 비밀번호는 아무도 모르는 임의 값으로 두고, 24시간짜리 재설정 링크를 출력한다.
 * 그 링크에서 관리자가 직접 비밀번호를 정한 뒤 회사 정보·현장·차량·단가를 등록하고 사람을 초대한다.
 *
 *   CONFIRM_FRESH_START=지우기 npx tsx scripts/start-fresh.ts [관리자아이디] [관리자이름]
 */
async function main() {
  if (process.env.CONFIRM_FRESH_START !== '지우기') {
    console.error('모든 데이터를 지웁니다. 확인하려면 CONFIRM_FRESH_START=지우기 를 붙여 실행하세요.');
    process.exit(1);
  }
  const loginId = process.argv[2] ?? 'admin';
  const name = process.argv[3] ?? '관리자';
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    const token = newToken();
    await db.transaction(async (tx) => {
      const tables = await tx.execute<{ name: string }>(sql`
        SELECT quote_ident(table_schema) || '.' || quote_ident(table_name) AS name
        FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
          AND table_name <> '__drizzle_migrations'`);
      await tx.execute(
        sql.raw(`TRUNCATE ${tables.rows.map((row) => row.name).join(', ')} RESTART IDENTITY CASCADE`),
      );
      const sequences = await tx.execute<{ name: string }>(sql`
        SELECT quote_ident(sequence_schema) || '.' || quote_ident(sequence_name) AS name
        FROM information_schema.sequences
        WHERE sequence_schema = current_schema() AND sequence_name NOT LIKE '%drizzle%'`);
      for (const row of sequences.rows) await tx.execute(sql.raw(`ALTER SEQUENCE ${row.name} RESTART`));
      const [admin] = await tx
        .insert(users)
        .values({
          login_id: loginId,
          name,
          role: 'ADMIN',
          all_projects: true,
          password_hash: await hashPassword(randomBytes(24).toString('base64url')),
        })
        .returning();
      await tx.insert(passwordResets).values({
        user_id: admin.id,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 86400000),
        created_by: admin.id,
      });
    });
    console.log(`시연 데이터를 지우고 관리자 계정(${loginId})을 만들었습니다.`);
    console.log(
      `비밀번호 정하기(24시간 안에 한 번): ${process.env.APP_URL ?? 'http://localhost:3000'}/reset/${token}`,
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
