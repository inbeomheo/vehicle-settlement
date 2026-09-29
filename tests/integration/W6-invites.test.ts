import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { POST } from '../../src/app/api/invites/route';

const database = testDatabase();

it('4: 초대 최초 응답만 토큰을 반환하고 DB 모든 테이블과 멱등 재생에서 제거한다', async () => {
  const s = await setupScenario(database().db);
  const { token } = await s.f.session(s.admin.id);
  const options = {
    method: 'POST',
    path: '/api/invites',
    token,
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: { role: 'SITE_MANAGER', name: '초대 토큰 검사', project_ids: [s.project.id] },
  };
  const first = await callRoute(database().db, POST, options);
  expect(first.status).toBe(200);
  const created = (await first.json()).data;
  const inviteToken = created.invite_url.split('/').at(-1);
  expect(inviteToken.length).toBeGreaterThan(20);

  const { rows: tables } = await database().pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  for (const { tablename } of tables) {
    const identifier = `"${tablename.replaceAll('"', '""')}"`;
    const { rows } = await database().pool.query(
      `SELECT row_to_json(t)::text AS body FROM ${identifier} t WHERE strpos(row_to_json(t)::text, $1) > 0`,
      [inviteToken],
    );
    expect(rows, `${tablename}에 원본 초대 토큰이 남으면 안 됩니다`).toHaveLength(0);
  }

  const replay = await callRoute(database().db, POST, options);
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  const repeated = (await replay.json()).data;
  expect(repeated.id).toBe(created.id);
  expect(repeated.invite_url).toBeUndefined();
  expect(repeated.message).toContain('이미 생성');
  const { rows } = await database().pool.query('SELECT count(*)::int AS count FROM invites');
  expect(rows[0].count).toBe(1);

  // The data migration also cleans responses stored by releases before W6.
  await database().pool.query(
    "UPDATE idempotency_keys SET response_body = jsonb_set(response_body, '{data,invite_url}', to_jsonb($1::text)) WHERE route = 'POST /api/invites'",
    [created.invite_url],
  );
  await database().pool.query(await readFile('drizzle/0100_w6_redact_invites.sql', 'utf8'));
  const legacyReplay = await callRoute(database().db, POST, options);
  expect(JSON.stringify(await legacyReplay.json())).not.toContain(inviteToken);
});
