import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDatabase, defaultDatabaseUrl, type Db } from '../src/server/db/client';
import { counterparties, drivers, projects, users, vehicleUses } from '../src/server/db/schema';
import type { Context } from '../src/server/context';
import { approveUse, createUse, getUse, requestFix, submitUse } from '../src/server/services/uses';
import { createEvidence, uploadEvidence } from '../src/server/services/evidence';
import { confirmStatement, createStatement } from '../src/server/services/statements';
import { recordPayment } from '../src/server/services/payments';
import { getDashboard } from '../src/server/services/dashboard';

type DemoUse = {
  date: string;
  driver: 0 | 1;
  status: 'DRAFT' | 'SUBMITTED' | 'NEEDS_FIX' | 'APPROVED';
  cargo: string;
  count?: number;
  quantity?: string;
  group?: 'paid' | 'unpaid';
  customer?: boolean;
  held?: boolean;
};
const samples: DemoUse[] = [
  { date: '2026-09-01', driver: 0, status: 'APPROVED', cargo: '거푸집·안전 펜스', count: 5, group: 'paid' },
  { date: '2026-09-02', driver: 1, status: 'SUBMITTED', cargo: '쇄석 15톤', count: 3, quantity: '3' },
  { date: '2026-09-03', driver: 0, status: 'APPROVED', cargo: '전기 배관 자재', count: 2, group: 'paid' },
  {
    date: '2026-09-04',
    driver: 1,
    status: 'APPROVED',
    cargo: '기초 철근 묶음',
    count: 3,
    quantity: '3',
    group: 'unpaid',
  },
  { date: '2026-09-07', driver: 0, status: 'NEEDS_FIX', cargo: '단열재·방수 시트', count: 2 },
  { date: '2026-09-08', driver: 1, status: 'APPROVED', cargo: '배수로 흄관', count: 4, quantity: '4' },
  { date: '2026-09-09', driver: 0, status: 'APPROVED', cargo: '도장 자재·작업 발판', count: 3, held: true },
  {
    date: '2026-09-10',
    driver: 1,
    status: 'APPROVED',
    cargo: '콘크리트 블록',
    count: 5,
    quantity: '5',
    group: 'unpaid',
  },
  { date: '2026-09-11', driver: 0, status: 'SUBMITTED', cargo: '현장 사무실 비품', count: 2 },
  { date: '2026-09-14', driver: 1, status: 'NEEDS_FIX', cargo: '조경석·경계석', count: 2, quantity: '2' },
  {
    date: '2026-09-16',
    driver: 0,
    status: 'APPROVED',
    cargo: '한빛 원청 납품 자재',
    count: 5,
    customer: true,
  },
  { date: '2026-09-18', driver: 1, status: 'SUBMITTED', cargo: '외벽 패널', count: 3, quantity: '3' },
  { date: '2026-09-21', driver: 0, status: 'APPROVED', cargo: '소방 배관·밸브', count: 2 },
  { date: '2026-09-23', driver: 1, status: 'DRAFT', cargo: '골재 추가 반입', count: 2, quantity: '2' },
  { date: '2026-09-25', driver: 0, status: 'DRAFT', cargo: '준공 청소 장비', count: 1 },
  { date: '2026-08-28', driver: 0, status: 'APPROVED', cargo: '8월분 이월 자재 운반', count: 3 },
];
const requestId = (index: number) => `demo-202609-use-${String(index + 1).padStart(2, '0')}`;

// A small, valid PNG drawn locally for demo evidence; no real customer photograph.
function demoImage() {
  const width = 96;
  const height = 64;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color = [224, 239, 249];
      if (y > 48) color = [148, 163, 184];
      if (x > 15 && x < 60 && y > 22 && y < 45) color = [37, 99, 235];
      if (x >= 60 && x < 80 && y > 31 && y < 45) color = [249, 115, 22];
      if ((x - 29) ** 2 + (y - 46) ** 2 < 30 || (x - 69) ** 2 + (y - 46) ** 2 < 30) color = [30, 41, 59];
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      rows.set(color, offset);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function seedDemo(db: Db) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('seed-demo-202609', 0))`);
    const accounts = await tx
      .select()
      .from(users)
      .where(inArray(users.login_id, ['admin', 'driver1', 'driver2']));
    const admin = accounts.find((user) => user.login_id === 'admin');
    const driverAccounts = ['driver1', 'driver2'].map((id) => accounts.find((user) => user.login_id === id));
    if (!admin || driverAccounts.some((user) => !user?.driver_id))
      throw new Error('먼저 npm run seed를 실행하세요.');
    const ctx: Context = { db: tx, user: admin, request_id: randomUUID() };
    const existing = await tx
      .select({ id: vehicleUses.id })
      .from(vehicleUses)
      .where(
        inArray(
          vehicleUses.client_request_id,
          samples.map((_, index) => requestId(index)),
        ),
      );
    if (existing.length === samples.length)
      return { created: false, count: existing.length, dashboard: await getDashboard(ctx) };
    if (existing.length)
      throw new Error('데모 일부만 남아 있습니다. 로컬 db:reset 및 seed 후 다시 실행하세요.');
    const [project] = await tx.select().from(projects).where(eq(projects.code, 'SEOUL'));
    const [customer] = await tx.select().from(counterparties).where(eq(counterparties.name, '한빛 원청'));
    if (!project || !customer) throw new Error('기본 시드의 현장·고객 정보가 필요합니다.');
    const image = demoImage();
    const groups: Record<'paid' | 'unpaid', { counterparty: string; lines: string[] }> = {
      paid: { counterparty: '', lines: [] },
      unpaid: { counterparty: '', lines: [] },
    };
    for (const [index, sample] of samples.entries()) {
      const account = driverAccounts[sample.driver]!;
      const [driver] = await tx.select().from(drivers).where(eq(drivers.id, account.driver_id!));
      if (!driver.default_vehicle_id) throw new Error('기사 기본 차량이 필요합니다.');
      const author = sample.customer ? ctx : { ...ctx, user: account };
      let use = await createUse(author, {
        client_request_id: requestId(index),
        use_date: sample.date,
        project_id: project.id,
        driver_id: driver.id,
        vehicle_id: driver.default_vehicle_id,
        customer_counterparty_id: sample.customer ? customer.id : undefined,
        cargo_desc: sample.cargo,
        requester: '서울 현장 자재팀',
        notes: '2026년 9월 시연 자료',
        operation_status: sample.status === 'DRAFT' ? 'IN_PROGRESS' : 'COMPLETED',
        quantity: sample.quantity,
        trips: Array.from({ length: sample.count ?? 1 }, (_, trip) => ({
          seq: trip + 1,
          origin: sample.driver === 0 ? '김포 자재 물류센터' : '인천 북항 야적장',
          destination: trip % 2 ? '서울 현장 동측 하차장' : '서울 현장 1문',
          cargo_desc: sample.cargo,
          status: 'COMPLETED',
        })),
        charge_lines: sample.held
          ? [
              { charge_type: 'BASE', quantity: '1' },
              {
                charge_type: 'WAITING',
                requested_amount: 50000,
                reason: '하차 장비 점검으로 2시간 대기, 현장 확인 중',
              },
              { charge_type: 'TOLL', requested_amount: 6600, reason: '수도권 순환고속도로 통행 영수증' },
            ]
          : undefined,
      });
      // Drafts intentionally await evidence so the dashboard has a missing-evidence example.
      if (sample.status === 'DRAFT') continue;
      const file = await createEvidence(author, use.id, {
        client_upload_id: `demo-202609-photo-${index + 1}`,
        kind: 'PHOTO',
        original_name: `시연용-현장증빙-${sample.date}.png`,
        mime: 'image/png',
        size: image.length,
      });
      await uploadEvidence(author, file.id, image, 'image/png');
      use = await getUse(author, use.id);
      use = await submitUse(author, use.id, { version: use.version });
      if (sample.status === 'NEEDS_FIX') {
        await requestFix(ctx, use.id, {
          version: use.version,
          fix_items: [
            { target: 'trip:1.destination', message: '현장 내 하차 위치를 구체적으로 입력해 주세요.' },
          ],
          comment: '실적 확인을 위해 하차장 보완 요청',
        });
      } else if (sample.status === 'APPROVED') {
        const detail = await getUse(ctx, use.id);
        use = await approveUse(ctx, use.id, {
          version: detail.version,
          lines: detail.charge_lines.map((line) => ({
            id: line.id,
            line_review_status: line.charge_type === 'WAITING' ? 'HELD' : 'APPROVED',
            reason: line.charge_type === 'WAITING' ? '현장 대기 시간 확인 후 별도 지급' : undefined,
          })),
        });
        if (sample.group) {
          groups[sample.group].counterparty = use.payee_counterparty_id;
          groups[sample.group].lines.push(
            ...use.charge_lines.filter((line) => line.direction === 'PAYABLE').map((line) => line.id),
          );
        }
      }
    }
    for (const group of ['paid', 'unpaid'] as const) {
      const data = groups[group];
      let statement = await createStatement(ctx, {
        client_request_id: `demo-202609-statement-${group}`,
        direction: 'PAYABLE',
        counterparty_id: data.counterparty,
        period_start: '2026-09-01',
        period_end: '2026-09-30',
        title: group === 'paid' ? '9월 한길 운송 지급명세' : '9월 동서 운송 지급명세',
        due_date: group === 'paid' ? '2026-09-25' : '2026-10-10',
        items: data.lines.map((charge_line_id) => ({ charge_line_id })),
      });
      statement = await confirmStatement(ctx, statement.id, { version: statement.version });
      if (group === 'paid') {
        await recordPayment(ctx, statement.id, {
          client_request_id: 'demo-202609-payment',
          kind: 'PAYMENT',
          amount: statement.grand_total,
          paid_on: '2026-09-25',
          method: '계좌이체',
          reference: 'DEMO-20260925-001',
          memo: '9월분 전액 지급 시연',
        });
      }
    }
    return { created: true, count: samples.length, dashboard: await getDashboard(ctx) };
  });
}

async function main() {
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    const result = await seedDemo(db);
    console.log(
      `9월 시연 데이터 ${result.created ? '생성' : '유지'}: 사용 ${result.count}건 (8월 이월 1건 포함), 확정 지급명세 2건`,
    );
    console.log('담당자 대시보드:', result.dashboard);
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
