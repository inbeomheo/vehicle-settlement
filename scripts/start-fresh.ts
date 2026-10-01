import { randomBytes } from 'node:crypto';
import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/server/db/schema';
import { databaseSchema } from '../src/server/db/config';
import { safeError } from '../src/server/safe-error';
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
    console.error('앱 업무 데이터를 지웁니다. 확인하려면 CONFIRM_FRESH_START=지우기 를 붙여 실행하세요.');
    process.exit(1);
  }
  const loginId = process.argv[2] ?? 'admin';
  const name = process.argv[3] ?? '관리자';
  if (!process.env.DATABASE_URL && !process.env.PG_PORT)
    throw new Error('대상 DATABASE_URL 또는 PG_PORT를 명시하세요.');
  const target = new URL(defaultDatabaseUrl());
  const targetSchema = databaseSchema();
  console.log(
    `초기화 대상: ${target.hostname}:${target.port || '5432'} / DB=${decodeURIComponent(target.pathname.slice(1))} / DB_SCHEMA=${targetSchema}`,
  );
  const { db, pool } = createDatabase(target.toString());
  try {
    const token = newToken();
    await db.transaction(async (tx) => {
      const result = await tx.execute<{ database: string; schema: string }>(sql`
        SELECT current_database() AS database, current_schema() AS schema`);
      if (
        result.rows[0]?.database !== decodeURIComponent(target.pathname.slice(1)) ||
        result.rows[0]?.schema !== targetSchema
      )
        throw new Error('대상 DB 또는 DB_SCHEMA가 일치하지 않습니다. 초기화를 중단합니다.');
      const tables = Object.values(schema)
        .filter((value) => is(value, PgTable))
        .map((table) => getTableName(table));
      const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
      // RESTRICT is deliberate: an external FK must abort the entire transaction.
      // ONLY also prevents inheritance/partition descendants outside this list from being emptied.
      await tx.execute(
        sql.raw(
          `TRUNCATE ${tables.map((name) => `ONLY ${quote(targetSchema)}.${quote(name)}`).join(', ')} RESTART IDENTITY RESTRICT`,
        ),
      );
      for (const name of ['use_no_seq', 'statement_no_seq'])
        await tx.execute(sql.raw(`ALTER SEQUENCE ${quote(targetSchema)}.${quote(name)} RESTART`));
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
  console.error('초기화 실패', safeError(error));
  process.exit(1);
});
