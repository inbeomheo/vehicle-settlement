import { Readable } from 'node:stream';
import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { AppError, invalid } from '../errors';
import type { SheetData } from './import-fields';

const MAX_JSON = 5 * 1024 * 1024;
const MAX_XML = 32 * 1024 * 1024;
const tooLarge = () =>
  invalid('파일이 너무 큽니다. 2,000행·100열, 셀당 500자, 저장 자료 5MB 이하로 나누어 주세요.');
export function boundedPayload<T>(payload: T): T {
  try {
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_JSON) tooLarge();
    return payload;
  } catch (error) {
    if (error instanceof RangeError) tooLarge();
    throw error;
  }
}
// Reject inflated ZIPs before ExcelJS caches shared strings/styles or spools XML.
// ZIP64/multipart/encrypted archives are unnecessary for a <=10 MB import.
function orderedArchive(bytes: Buffer) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) invalid('xlsx 파일을 읽을 수 없습니다.');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  if (count > 500 || bytes.readUInt16LE(end + 4) !== 0) tooLarge();
  let total = 0;
  const entries: { name: string; local: Buffer; central: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      invalid('손상된 xlsx 파일입니다.');
    const size = bytes.readUInt32LE(offset + 24);
    total += size;
    if (total > MAX_XML || bytes.readUInt16LE(offset + 8) & 1) tooLarge();
    const nameLength = bytes.readUInt16LE(offset + 28);
    const length = 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    const central = Buffer.from(bytes.subarray(offset, offset + length));
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localOffset = bytes.readUInt32LE(offset + 42);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50)
      invalid('손상된 xlsx 파일입니다.');
    const headerLength = 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const dataStart = localOffset + headerLength;
    if (dataStart + compressedSize > bytes.length) invalid('손상된 xlsx 파일입니다.');
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const method = central.readUInt16LE(10);
    let actual = -1;
    try {
      // maxOutputLength also rejects forged central-directory sizes before ExcelJS.
      actual =
        method === 0
          ? compressed.length
          : method === 8
            ? inflateRawSync(compressed, { maxOutputLength: Math.max(1, MAX_XML - total + size) }).length
            : -1;
    } catch {
      tooLarge();
    }
    if (actual !== size) invalid('손상된 xlsx 파일입니다.');
    const header = Buffer.from(bytes.subarray(localOffset, dataStart));
    header.writeUInt16LE(header.readUInt16LE(6) & ~8, 6);
    central.writeUInt16LE(central.readUInt16LE(8) & ~8, 8);
    central.copy(header, 14, 16, 28); // CRC, compressed size, uncompressed size.
    entries.push({ name, local: Buffer.concat([header, compressed]), central });
    offset += length;
  }
  // ExcelJS 4's deferred-sheet path can lose subsequent ZIP entries while it
  // awaits temporary-file writes on Node 24. Put metadata before worksheets so
  // WorkbookReader can stream rows directly and never creates those temp files.
  const priority = (name: string) =>
    name === 'xl/_rels/workbook.xml.rels'
      ? 0
      : name === 'xl/workbook.xml'
        ? 1
        : name === 'xl/styles.xml'
          ? 2
          : name === 'xl/sharedStrings.xml'
            ? 3
            : 4;
  entries.sort((a, b) => priority(a.name) - priority(b.name));
  let position = 0;
  for (const entry of entries) {
    entry.central.writeUInt32LE(position, 42);
    position += entry.local.length;
  }
  const directory = Buffer.concat(entries.map((entry) => entry.central));
  const footer = Buffer.from(bytes.subarray(end));
  footer.writeUInt32LE(directory.length, 12);
  footer.writeUInt32LE(position, 16);
  return Buffer.concat([...entries.map((entry) => entry.local), directory, footer]);
}
function textCell(value: ExcelJS.CellValue): { text: string; error?: string } {
  if (value == null) return { text: '' };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10) };
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      if (value.result == null || (typeof value.result === 'number' && !Number.isFinite(value.result)))
        return {
          text: '',
          error: '수식 결과가 없습니다. Excel에서 계산 후 저장하거나 값으로 붙여넣어 주세요.',
        };
      return textCell(value.result);
    }
    if ('error' in value) return { text: '', error: '오류 셀입니다. 값을 확인하세요.' };
    if ('richText' in value) return { text: value.richText.map((v) => v.text).join('') };
    if ('text' in value) return { text: value.text };
    return { text: '', error: '해석할 수 없는 셀 값입니다.' };
  }
  return { text: String(value).trim() };
}
function blankSheet(name: string): SheetData {
  return { name, rows: [], header_row: 1, mapping: {}, cell_errors: {} };
}
export async function readXlsx(bytes: Buffer, selected: number, catalog = false): Promise<SheetData[]> {
  let input: Readable | undefined;
  const sheets: SheetData[] = [];
  let failure: unknown;
  let storedBytes = 0;
  try {
    input = Readable.from([orderedArchive(bytes)], { objectMode: false });
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, {
      worksheets: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'cache',
      entries: 'ignore',
    });
    // Workbooks without shared strings still stream directly after metadata.
    (reader as unknown as { sharedStrings: unknown[] }).sharedStrings = [];
    for await (const worksheet of reader) {
      const index = sheets.length;
      const sheet = blankSheet((worksheet as unknown as { name: string }).name);
      sheets.push(sheet);
      if (sheets.length > 20) failure = new AppError('VALIDATION_FAILED', '시트는 1~20개여야 합니다.');
      // Non-selected sheets are drained as XML, never converted into Row/Cell objects.
      // On upload only, read <=20 rows per sheet to suggest headers and mappings.
      if (!failure && (index === selected || catalog)) {
        try {
          for await (const row of worksheet) {
            if (row.number > (index === selected ? 2000 : 20)) {
              if (index === selected) tooLarge();
              break;
            }
            if (row.cellCount > 100) tooLarge();
            const values = Array.from({ length: row.cellCount }, (_, col) => {
              const value = textCell(row.getCell(col + 1).value);
              if (value.text.length > 500) tooLarge();
              if (value.error) (sheet.cell_errors![row.number] ??= {})[col] = value.error;
              return value.text;
            });
            storedBytes += Buffer.byteLength(JSON.stringify(values));
            if (storedBytes > MAX_JSON) tooLarge();
            while (sheet.rows.length < row.number - 1) sheet.rows.push([]);
            sheet.rows.push(values);
          }
        } catch (error) {
          failure = error;
        }
      }
      // Finish the iterator even on rejection so ExcelJS removes deferred temp files.
      const iterator = (worksheet as unknown as { iterator: AsyncIterable<unknown> }).iterator;
      try {
        for await (const chunk of iterator) {
          void chunk;
        }
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
    if (!sheets.length || (selected >= 0 && !sheets[selected])) invalid('선택한 시트를 찾을 수 없습니다.');
    return boundedPayload(sheets);
  } catch (error) {
    if (error instanceof RangeError) tooLarge();
    if (error instanceof AppError) throw error;
    return invalid('파일을 읽을 수 없습니다. 손상 여부를 확인하세요.');
  } finally {
    if (input) input.destroy();
  }
}
export function readCsv(bytes: Buffer): SheetData[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    invalid('CSV 인코딩을 UTF-8 로 저장해 주세요 (Excel: CSV UTF-8)');
  }
  const sheet = blankSheet('CSV');
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const pushCell = () => {
    row.push(cell.trim());
    if (row.length > 100) tooLarge();
    cell = '';
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    sheet.rows.push(row);
    row = [];
    if (sheet.rows.length > 2000) tooLarge();
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') {
      pushRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed || char === '"') invalid('CSV 따옴표 형식을 확인하세요.');
    else cell += char;
    if (cell.length > 500) tooLarge();
  }
  if (quoted) invalid('CSV 따옴표가 닫히지 않았습니다.');
  if (cell || row.length || closed) pushRow();
  return boundedPayload([sheet]);
}
