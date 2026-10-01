import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { createDatabase, defaultDatabaseUrl, withDatabase } from '../../src/server/db/client';
import { migrateDatabase } from '../../src/server/db/migrate';
import { poolConfig } from '../../src/server/db/config';
import { evidence, evidenceBlobs, users } from '../../src/server/db/schema';
import { createPasswordReset, resetPassword } from '../../src/server/services/password';
import { factories } from '../helpers/factories';
import { storageDriver, readStoredFile, deleteStoredFile, writeStoredFile } from '../../src/server/storage';
import { uploadLimit } from '../../src/server/upload-limits';
import {
  createEvidence,
  uploadEvidence,
  downloadEvidence,
  deleteEvidence,
  readUpload,
} from '../../src/server/services/evidence';
import { uploadImport, previewImport } from '../../src/server/services/import';
import { createUse } from '../../src/server/services/uses';
import { withRoute } from '../../src/server/http';
import { scenario, approved, confirmed } from './W4-fixtures';
import { backup } from '../../scripts/backup';
import { restore } from '../../scripts/restore';
import { resetAppSchema, verifyDatabase } from '../../scripts/backup-common';
import { seedDemo } from '../../scripts/seed-demo';
import { streamingRequest } from '../helpers/request-stream';

const unique = randomUUID().replaceAll('-', '');
const name = `deploy_${unique}`;
const role = `role_${unique}`;
const base = new URL(process.env.TEST_DATABASE_URL ?? defaultDatabaseUrl());
base.pathname = '/postgres';
const admin = new Client({ connectionString: base.toString() });
let owner: Client;
let database: ReturnType<typeof createDatabase>;
let url: string;
let temp: string;

beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vehicle-deploy-'));
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${unique}' NOINHERIT NOCREATEDB NOCREATEROLE`);
  base.pathname = `/${name}`;
  owner = new Client({ connectionString: base.toString() });
  await owner.connect();
  // Only this disposable test database is changed; emulate a private shared DB.
  await owner.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await owner.query(
    'CREATE TABLE public.other_app (id int PRIMARY KEY); INSERT INTO public.other_app VALUES (82)',
  );
  await owner.query(`CREATE SCHEMA vehicle AUTHORIZATION "${role}"`);
  await owner.query(`REVOKE CREATE ON DATABASE "${name}" FROM PUBLIC`);
  vi.stubEnv('DB_SCHEMA', 'vehicle');
  vi.stubEnv('STORAGE_DRIVER', 'db');
  vi.stubEnv('MAX_UPLOAD_BYTES', '4194304');
  vi.stubEnv('PG_POOL_MAX', '3');
  vi.stubEnv('STORAGE_DIR', path.join(temp, 'must-not-be-created'));
  base.username = role;
  base.password = unique;
  url = base.toString();
  database = createDatabase(url);
  await migrateDatabase(database.db);
});
afterAll(async () => {
  await database?.pool.end();
  await owner?.end();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`DROP ROLE IF EXISTS "${role}"`);
  await admin.end();
  vi.unstubAllEnvs();
  if (temp) await rm(temp, { recursive: true, force: true });
});

it('제한 롤: 모든 연결의 vehicle search_path, 내장 UUID, 마이그레이션 반복 및 public 격리', async () => {
  const connections = await Promise.all(Array.from({ length: 3 }, () => database.pool.connect()));
  try {
    for (const client of connections) {
      const row = (await client.query('SELECT current_schema() AS schema, gen_random_uuid() AS uuid'))
        .rows[0];
      expect(row.schema).toBe('vehicle');
      expect(row.uuid).toMatch(/^[a-f0-9-]{36}$/);
      await expect(client.query('SELECT * FROM public.other_app')).rejects.toMatchObject({ code: '42501' });
      await expect(client.query('CREATE SCHEMA forbidden')).rejects.toMatchObject({ code: '42501' });
    }
  } finally {
    connections.forEach((client) => client.release());
  }
  await migrateDatabase(database.db);
  expect((await database.pool.query('SELECT count(*) FROM __drizzle_migrations')).rows[0].count).toBe('16');
  expect((await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows).toEqual([
    { tablename: 'other_app' },
  ]);
  expect((await owner.query('SELECT * FROM public.other_app')).rows).toEqual([{ id: 82 }]);
  expect((await owner.query("SELECT nspname FROM pg_namespace WHERE nspname='drizzle'")).rows).toEqual([]);
  vi.stubEnv('DB_SCHEMA', 'missing');
  const missing = createDatabase(url);
  try {
    await expect(migrateDatabase(missing.db)).rejects.toThrow('스키마가 없습니다');
  } finally {
    await missing.pool.end();
    vi.stubEnv('DB_SCHEMA', 'vehicle');
  }
});

it('vehicle에서 기본 시드·데모·정산 업무·DB 증빙·XLSX 원본 및 복구 왕복', async () => {
  await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], {
    env: { ...process.env, DATABASE_URL: url },
  });
  await seedDemo(database.db);
  expect(await database.db.select().from(users).where(eq(users.login_id, 'admin'))).toHaveLength(1);
  const s = await scenario(database.db);
  const use = await createUse(s.driverCtx, s.input);
  const bytes = Buffer.from('%PDF-1.7\n배포 증빙\n%%EOF');
  const file = await createEvidence(s.driverCtx, use.id, {
    client_upload_id: randomUUID(),
    kind: 'RECEIPT',
    original_name: '증빙.pdf',
    mime: 'application/pdf',
    size: bytes.length,
  });
  await uploadEvidence(s.driverCtx, file.id, bytes, 'application/pdf');
  await uploadEvidence(s.driverCtx, file.id, bytes, 'application/pdf');
  expect((await downloadEvidence(s.driverCtx, file.id)).bytes).toEqual(bytes);
  const stranger = await s.f.user({ role: 'DRIVER', driver_id: (await s.f.driver()).id });
  await expect(downloadEvidence({ ...s.driverCtx, user: stranger }, file.id)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  const [meta] = await database.db.select().from(evidence).where(eq(evidence.id, file.id));
  await database.db
    .update(evidenceBlobs)
    .set({ sha256: '0'.repeat(64) })
    .where(eq(evidenceBlobs.storage_key, meta.storage_key!));
  await expect(readStoredFile(database.db, meta.storage_key!)).rejects.toThrow('해시');
  await database.db
    .update(evidenceBlobs)
    .set({ sha256: meta.sha256! })
    .where(eq(evidenceBlobs.storage_key, meta.storage_key!));
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('원본').addRows([
    ['사용일', '현장'],
    ['2026-09-29', '서울 현장'],
  ]);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  const job = await uploadImport(s.adminCtx, '원본.xlsx', xlsx);
  expect(await readStoredFile(database.db, `imports/${job.id}.xlsx`)).toEqual(xlsx);
  await previewImport(s.adminCtx, job.id, { sheet: 0, header_row: 1, mapping: { use_date: 0, project: 1 } });
  const approvedUse = await approved(s);
  await confirmed(
    s,
    approvedUse.charge_lines.map((line) => line.id),
  );
  const key = `${use.id}/${randomUUID()}`;
  await expect(
    database.db.transaction(async (tx) => {
      await writeStoredFile(tx, key, bytes);
      throw new Error('롤백');
    }),
  ).rejects.toThrow('롤백');
  await expect(readStoredFile(database.db, key)).rejects.toThrow('없습니다');
  await writeStoredFile(database.db, key, bytes);
  await deleteStoredFile(database.db, key);
  await expect(readStoredFile(database.db, key)).rejects.toThrow('없습니다');
  await expect(access(process.env.STORAGE_DIR!)).rejects.toMatchObject({ code: 'ENOENT' });
  const directory = path.join(temp, 'backup');
  const storage = path.join(temp, 'restore-storage');
  const manifest = await backup({ directory, url, storage });
  expect(manifest).toMatchObject({
    db_schema: 'vehicle',
    storage_driver: 'db',
    format: 'app-logical-v1',
    file_count: 1,
  });
  const saved = JSON.parse(await readFile(path.join(directory, 'database.json'), 'utf8'));
  expect(saved.tables.every((table: { schema: string }) => table.schema === 'vehicle')).toBe(true);
  await expect(restore({ directory, url, storage })).rejects.toThrow('데이터가 있습니다');
  const client = await database.pool.connect();
  try {
    await resetAppSchema(client);
  } finally {
    client.release();
  }
  await restore({ directory, url, storage });
  expect((await downloadEvidence(s.driverCtx, file.id)).bytes).toEqual(bytes);
  expect(await readStoredFile(database.db, `imports/${job.id}.xlsx`)).toEqual(xlsx);
  await deleteEvidence(s.driverCtx, file.id, '잘못 첨부');
  await expect(downloadEvidence(s.driverCtx, file.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  // Logical deletion keeps originals for history, matching the local driver.
  expect(await readStoredFile(database.db, meta.storage_key!)).toEqual(bytes);
  const verifier = await database.pool.connect();
  try {
    await verifyDatabase(verifier, storage);
  } finally {
    verifier.release();
  }
  expect((await owner.query('SELECT * FROM public.other_app')).rows).toEqual([{ id: 82 }]);
}, 60000);

it('배포 업로드/JSON 실제 스트림 제한과 SSL 옵션 검증', async () => {
  expect(uploadLimit()).toBe(4194304);
  const input = streamingRequest(1024 * 1024);
  await expect(readUpload(input.request)).rejects.toMatchObject({
    status: 413,
    message: expect.stringContaining('4MB'),
  });
  expect(input.state()).toEqual({ emitted: 5, cancelled: true });
  vi.stubEnv('MAX_UPLOAD_BYTES', '16');
  const json = streamingRequest(8);
  const route = withRoute(async () => ({}), { auth: false });
  const response = await withDatabase(database.db, () =>
    route(json.request, { params: Promise.resolve({}) }),
  );
  expect(response.status).toBe(413);
  expect(json.state()).toEqual({ emitted: 3, cancelled: true });
  vi.stubEnv('MAX_UPLOAD_BYTES', '4194304');
  vi.stubEnv('PG_SSL_NO_VERIFY', '1');
  const config = poolConfig(`${url}?sslmode=require`);
  expect(config.ssl).toEqual({ rejectUnauthorized: false });
  expect(config.connectionString).not.toContain('sslmode');
  vi.stubEnv('PG_SSL_NO_VERIFY', '0');
  expect(poolConfig(`${url}?sslmode=require`).connectionString).toContain('sslmode=require');
  expect(storageDriver()).toBe('db');
});

it('vehicle 스키마에서 비밀번호 재설정 링크와 감사·세션 갱신도 동작한다', async () => {
  const f = factories(database.db);
  const user = await f.user();
  await f.session(user.id);
  const link = await createPasswordReset(f.context(user), user.id);
  const token = new URL(link.reset_url).pathname.split('/').at(-1)!;
  await resetPassword(database.db, randomUUID(), token, {
    password: 'schema-new1234',
    password_confirmation: 'schema-new1234',
  });
  expect(
    (await database.pool.query('SELECT used_at FROM password_resets WHERE id=$1', [link.id])).rows[0].used_at,
  ).not.toBeNull();
  expect(
    (
      await owner.query(
        "SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename='password_resets'",
      )
    ).rows[0].n,
  ).toBe(0);
});

it('vehicle 스키마에서 공용 링크 가입·기사 정보 변경·현장 삭제 보호가 동작한다', async () => {
  const { createJoinLink, registerDriver } = await import('../../src/server/services/driver-join');
  const { getDriverProfile, updateDriverProfile } = await import('../../src/server/services/driver-profiles');
  const { deleteProject } = await import('../../src/server/services/admin');
  const f = factories(database.db);
  const adminUser = await f.user();
  const project = await f.project();
  const ctx = f.context(adminUser);
  const link = await createJoinLink(ctx, { project_ids: [project.id] });
  const token = new URL(link.join_url).pathname.split('/').at(-1)!;
  const profile = {
    name: '스키마 기사',
    phone: '01098761234',
    business_name: '스키마 운송',
    biz_no: '999-88-77777',
    plate_no: '서울80아9999',
    vehicle_type: '카고',
    tonnage: '8',
  };
  const joined = await registerDriver(database.db, randomUUID(), token, {
    profile,
    client_request_id: randomUUID(),
    login_id: `schema-${randomUUID()}`,
    password: 'password1234',
  });
  expect((await getDriverProfile(ctx, joined.user.id)).projects).toEqual([
    { id: project.id, name: project.name },
  ]);
  expect(
    (await updateDriverProfile(ctx, joined.user.id, { ...profile, name: '변경 기사', version: 1 })).name,
  ).toBe('변경 기사');
  await expect(deleteProject(ctx, project.id)).rejects.toThrow('사용 중지');
  expect(
    (
      await owner.query(
        "SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename IN ('driver_join_links','driver_registrations')",
      )
    ).rows[0].n,
  ).toBe(0);
});
