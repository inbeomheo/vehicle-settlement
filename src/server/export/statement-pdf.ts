import path from 'node:path';
import PDFDocument from 'pdfkit';
import {
  exportHeaders,
  formatWon,
  rowValues,
  statementPartyHeaders,
  type StatementExportModel,
} from './statement-model';
export async function renderStatementPdf(model: StatementExportModel): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 28,
    bufferPages: true,
    info: {
      Title: `${model.title} ${model.document_no}`,
      Author: String(model.issuer.name ?? ''),
      Subject: `총액 ${formatWon(model.grand_total)}`,
    },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.font(path.join(process.cwd(), 'assets/fonts/NotoSansKR-Regular.ttf'));
  const widths = [57, 73, 57, 60, 43, 68, 60, 30, 40, 35, 60, 62, 49, 91];
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const left = 28;
  let y = 28;
  const label = (text: string, size = 10) => {
    doc.fontSize(size);
    if (y + doc.heightOfString(text, { width: totalWidth }) > 510) {
      doc.addPage();
      watermark();
      y = 28;
    }
    doc.fillColor('#173849').text(text, left, y, { width: totalWidth });
    y = doc.y + 6;
  };
  function watermark() {
    if (!model.draft && !model.canceled) return;
    doc.save().fillOpacity(0.09).fontSize(105).fillColor('#123849');
    doc.text(model.draft ? '초안' : '취소', 300, 240, { width: 260, align: 'center', lineBreak: false });
    doc.restore();
  }
  watermark();
  label(model.title, 21);
  label(`문서번호 ${model.document_no}    정산 기간 ${model.period}`, 10);
  for (const party of statementPartyHeaders(model)) {
    for (const line of party) label(line, 9);
  }
  label(`발행일 ${model.issued_on}    확정 시각 ${model.confirmed_at}    예정일 ${model.due_date}`);
  label(`담당자 ${model.contact}    연락처 ${model.issuer.settlement_contact ?? ''}`);
  y += 7;
  function header() {
    doc.rect(left, y, totalWidth, 29).fill('#173849');
    let x = left;
    exportHeaders.forEach((text, i) => {
      doc
        .fontSize(7.7)
        .fillColor('white')
        .text(text, x + 4, y + 5, { width: widths[i] - 8 });
      x += widths[i];
    });
    y += 29;
  }
  function newPage() {
    doc.addPage();
    watermark();
    y = 27;
    label(`${model.title} · ${model.document_no}`, 12);
    header();
  }
  function wrap(text: string, width: number) {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (line && doc.widthOfString(line + char) > width) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  }
  if (y + 51 > 538) newPage();
  else header();
  for (const row of model.rows) {
    doc.fontSize(7.5);
    const cells = rowValues(row).map((value, i) =>
      wrap(
        value === null
          ? '-'
          : typeof value === 'number' && i >= 10
            ? value.toLocaleString('ko-KR')
            : String(value),
        widths[i] - 8,
      ),
    );
    const maxLines = Math.max(...cells.map((lines) => lines.length));
    let offset = 0;
    while (offset < maxLines) {
      if (y + 22 > 538) newPage();
      const count = Math.min(maxLines - offset, Math.floor((538 - y - 10) / 11));
      const height = count * 11 + 10;
      let x = left;
      cells.forEach((lines, i) => {
        doc.lineWidth(0.3).strokeColor('#cbd5e1').rect(x, y, widths[i], height).stroke();
        doc.fontSize(7.5).fillColor('#172b3a');
        lines.slice(offset, offset + count).forEach((text, j) =>
          doc.text(text, x + 4, y + 5 + j * 11, {
            width: widths[i] - 8,
            lineBreak: false,
            align: i >= 7 && i <= 12 ? 'right' : 'left',
          }),
        );
        x += widths[i];
      });
      y += height;
      offset += count;
    }
  }
  if (y + 112 > 543) {
    doc.addPage();
    watermark();
    y = 28;
  }
  y += 16;
  label(`공급가 합계  ${formatWon(model.supply_total)}     세액 합계  ${formatWon(model.tax_total)}`, 11);
  label(`총액  ${formatWon(model.grand_total)}`, 17);
  label('작성 확인: ____________________      거래 상대방 확인: ____________________', 10);
  label(model.disclaimer, 9);
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .fillColor('#64748b')
      .text(`${i + 1} / ${range.count}`, 740, 547, { width: 70, align: 'right', lineBreak: false });
  }
  doc.end();
  return result;
}
