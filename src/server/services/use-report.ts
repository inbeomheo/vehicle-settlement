import path from 'node:path';
import PDFDocument from 'pdfkit';
import { eq } from 'drizzle-orm';
import type { Context } from '../context';
import { users } from '../db/schema';
import { getUse } from './uses';
import { proposedSupply } from '../../shared/charge-amount';
import { sumMoney } from '../domain/money';
import { formatQuantity } from '../../shared/quantity';

export async function renderUseReport(ctx: Context, id: string) {
  const use = await getUse(ctx, id);
  const approval = use.revisions.find(
    (revision) => revision.id === use.approved_revision_id && revision.decision === 'APPROVED',
  );
  const [approver] = approval?.decided_by
    ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, approval.decided_by))
    : [];
  const dateTime = (value: Date | string) =>
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
    info: { Title: `화물차 사용내역 보고서 ${use.use_no}`, Author: '차량 사용·정산' },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.font(path.join(process.cwd(), 'assets/fonts/NotoSansKR-Regular.ttf'));
  const left = 36,
    width = 523;
  let y = 36;
  function heading(title: string) {
    doc.fontSize(11).fillColor('#173849').text(title, left, y, { width });
    y = doc.y + 8;
  }
  function row(label: string, value: string) {
    if (value.length > 600) {
      const parts = value.match(/[\s\S]{1,600}/g)!;
      parts.forEach((part, index) => row(`${label}${index ? ' (계속)' : ''}`, part));
      return;
    }
    doc.fontSize(10);
    const height = Math.max(30, doc.heightOfString(value, { width: width - 130 }) + 12);
    if (height > 660) {
      let low = 1;
      let high = value.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (doc.heightOfString(value.slice(0, middle), { width: width - 130 }) + 12 <= 660) low = middle;
        else high = middle - 1;
      }
      row(label, value.slice(0, low));
      row(`${label} (계속)`, value.slice(low));
      return;
    }
    if (y + height > 745) {
      doc.addPage();
      y = 36;
      heading(`화물차 사용내역 보고서 · ${use.use_no} (계속)`);
    }
    doc.fontSize(10);
    doc.rect(left, y, 112, height).fill('#f1f5f9');
    doc.rect(left, y, width, height).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    doc.fillColor('#334155').text(label, left + 8, y + 6, { width: 96 });
    doc.fillColor('#172b3a').text(value || '—', left + 120, y + 6, { width: width - 130 });
    y += height;
  }
  const snapshot = (key: string) => String(use.snapshot[key] ?? '—');
  doc.fontSize(22).fillColor('#173849').text('화물차 사용내역 보고서', left, y, { width, align: 'center' });
  y = doc.y + 18;
  heading(
    `${use.use_no} · ${use.operation_status === 'CANCELED' ? '취소' : use.review_status === 'APPROVED' ? '승인 완료' : '검수 전 (미확정)'}`,
  );
  row('프로젝트명', snapshot('project_name'));
  row('작성일', dateTime(use.created_at));
  row('담당자', snapshot('reviewer_name'));
  y += 14;
  heading('화물차 정보');
  row('차량번호 / 기사명', `${snapshot('plate_no')} / ${snapshot('driver_name')}`);
  row(
    '차량종류 / 적재용량',
    `${snapshot('vehicle_type')} / ${use.load_tonnage ? `${formatQuantity(use.load_tonnage)}톤` : '미입력'}`,
  );
  y += 14;
  heading('운행 정보');
  row('운행일자', use.use_date);
  row('운행목적', use.cargo_desc || '—');
  for (const trip of use.trips) {
    const text = `${trip.origin} → ${trip.destination}${trip.cargo_desc ? `\n운반 내용: ${trip.cargo_desc}` : ''}${trip.status === 'CANCELED' ? ' (취소)' : ''}`;
    // Split exceptionally long cells before rendering, preserving every character.
    const parts = text.match(/[\s\S]{1,600}/g) ?? ['—'];
    for (let index = 0; index < parts.length; index++)
      row(`${trip.seq}회차${index ? ' (계속)' : ''}`, parts[index]);
  }
  const payable = use.charge_lines.filter(
    (line) =>
      line.direction === 'PAYABLE' &&
      (use.review_status === 'APPROVED'
        ? line.line_review_status === 'APPROVED'
        : line.line_review_status !== 'REJECTED'),
  );
  const amounts = payable.map((line) => line.approved_amount ?? proposedSupply(line));
  y += 14;
  row(
    use.review_status === 'APPROVED' ? '승인 금액 (공급가)' : '검수 전 금액 (공급가)',
    amounts.some((amount) => amount === null)
      ? '금액 미정'
      : `${sumMoney(amounts).toLocaleString('ko-KR')}원`,
  );
  const half = width / 2;
  const confirmation = approval?.decided_at
    ? `전자 확인: ${approver?.name ?? '담당자'} · ${dateTime(approval.decided_at)}`
    : '전자 확인: 승인 전';
  doc.fontSize(8);
  const signatureHeight = Math.max(96, doc.heightOfString(confirmation, { width: half - 20 }) + 74);
  if (y + 14 + signatureHeight > 765) {
    doc.addPage();
    y = 36;
    heading(`화물차 사용내역 보고서 · ${use.use_no} (계속)`);
  }
  y = Math.max(y + 14, 765 - signatureHeight);
  for (const [index, title] of ['기사 (서명)', '담당자 확인 (서명)'].entries()) {
    const x = left + index * half;
    doc.rect(x, y, half, signatureHeight).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    doc
      .fontSize(11)
      .fillColor('#172b3a')
      .text(title, x + 10, y + 10, { width: half - 20 });
  }
  doc
    .fontSize(8)
    .fillColor('#64748b')
    .text(confirmation, left + half + 10, y + 62, { width: half - 20 });
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .fillColor('#64748b')
      .text(`세금계산서가 아닙니다. · ${i + 1} / ${range.count}`, left, 785, {
        width,
        align: 'right',
        lineBreak: false,
      });
  }
  doc.end();
  return result;
}
export async function exportUseReport(ctx: Context, id: string) {
  return new Response(new Uint8Array(await renderUseReport(ctx, id)), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="use-report-${id}.pdf"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
