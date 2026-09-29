import { Readable } from 'node:stream';
import { createInflateRaw, crc32 } from 'node:zlib';
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
// Validate and decompress once, then give ExcelJS a STORE-only archive. The
// parser cannot reinterpret a forged compression method or inflate it again.
async function orderedArchive(bytes: Buffer, maxExpandedBytes: number) {
  const corrupt = (): never => invalid('손상된 xlsx 파일입니다.');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557)) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length)
      break;
    end--;
  }
  if (end < Math.max(0, bytes.length - 65557)) corrupt();
  const count = bytes.readUInt16LE(end + 10);
  const directoryStart = bytes.readUInt32LE(end + 16);
  const directorySize = bytes.readUInt32LE(end + 12);
  if (count > 500) tooLarge();
  if (
    !count ||
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== count ||
    directoryStart + directorySize !== end
  )
    corrupt();
  let offset = directoryStart;
  let total = 0;
  const entries: { name: string; local: Buffer; central: Buffer }[] = [];
  const names = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  const checkExtra = (start: number, length: number) => {
    const finish = start + length;
    while (start < finish) {
      if (start + 4 > finish) corrupt();
      const kind = bytes.readUInt16LE(start);
      const size = bytes.readUInt16LE(start + 2);
      // ZIP64 is not needed for bounded imports.
      if (kind === 1 || start + 4 + size > finish) corrupt();
      start += 4 + size;
    }
  };
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) corrupt();
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 24);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const crc = bytes.readUInt32LE(offset + 16);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const length = 46 + nameLength + extraLength + bytes.readUInt16LE(offset + 32);
    if (
      offset + length > end ||
      flags & ~0x80e ||
      ![0, 8].includes(method) ||
      bytes.readUInt16LE(offset + 34)
    )
      corrupt();
    if (size > maxExpandedBytes - total) tooLarge();
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = rawName.toString('utf8');
    if (
      !name ||
      names.has(name) ||
      name.includes('\\') ||
      name.startsWith('/') ||
      name.split('/').includes('..')
    )
      corrupt();
    names.add(name);
    checkExtra(offset + 46 + nameLength, extraLength);
    const localOffset = bytes.readUInt32LE(offset + 42);
    if (localOffset + 30 > directoryStart || bytes.readUInt32LE(localOffset) !== 0x04034b50) corrupt();
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (
      dataEnd > directoryStart ||
      bytes.readUInt16LE(localOffset + 6) !== flags ||
      bytes.readUInt16LE(localOffset + 8) !== method ||
      localNameLength !== nameLength ||
      !bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(rawName)
    )
      corrupt();
    checkExtra(localOffset + 30 + localNameLength, localExtraLength);
    const descriptor = Boolean(flags & 8);
    for (const [position, expected] of [
      [14, crc],
      [18, compressedSize],
      [22, size],
    ]) {
      const localValue = bytes.readUInt32LE(localOffset + position);
      if (localValue !== expected && !(descriptor && localValue === 0)) corrupt();
    }
    let entryEnd = dataEnd;
    if (descriptor) {
      if (entryEnd + 12 > directoryStart) corrupt();
      if (bytes.readUInt32LE(entryEnd) === 0x08074b50) entryEnd += 4;
      if (
        entryEnd + 12 > directoryStart ||
        bytes.readUInt32LE(entryEnd) !== crc ||
        bytes.readUInt32LE(entryEnd + 4) !== compressedSize ||
        bytes.readUInt32LE(entryEnd + 8) !== size
      )
        corrupt();
      entryEnd += 12;
    }
    if (ranges.some((range) => localOffset < range.end && entryEnd > range.start)) corrupt();
    ranges.push({ start: localOffset, end: entryEnd });
    const compressed = bytes.subarray(dataStart, dataEnd);
    const chunks: Buffer[] = [];
    let actual = 0;
    const accept = (chunk: Buffer) => {
      total += chunk.length;
      actual += chunk.length;
      if (total > maxExpandedBytes) tooLarge();
      chunks.push(chunk);
    };
    if (method === 0) accept(compressed);
    else {
      const inflater = createInflateRaw({ chunkSize: 16 * 1024 });
      inflater.end(compressed);
      try {
        for await (const chunk of inflater) accept(chunk as Buffer);
        if (inflater.bytesWritten !== compressedSize) corrupt();
      } finally {
        inflater.destroy();
      }
    }
    const expanded = Buffer.concat(chunks, actual);
    if (actual !== size || crc32(expanded) !== crc) corrupt();
    const header = Buffer.from(bytes.subarray(localOffset, dataStart));
    const central = Buffer.from(bytes.subarray(offset, offset + length));
    header.writeUInt16LE(flags & 0x800, 6);
    central.writeUInt16LE(flags & 0x800, 8);
    header.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(actual, 18);
    header.writeUInt32LE(actual, 22);
    central.writeUInt32LE(actual, 20);
    central.writeUInt32LE(actual, 24);
    entries.push({ name, local: Buffer.concat([header, expanded]), central });
    offset += length;
  }
  if (offset !== end) corrupt();
  ranges.sort((a, b) => a.start - b.start);
  if (
    ranges[0].start !== 0 ||
    ranges.at(-1)!.end !== directoryStart ||
    ranges.some((range, index) => index > 0 && ranges[index - 1].end !== range.start)
  )
    corrupt();
  // Metadata first avoids ExcelJS's deferred-sheet temporary-file path.
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
export async function readXlsx(
  bytes: Buffer,
  selected: number,
  catalog = false,
  maxExpandedBytes = MAX_XML,
): Promise<SheetData[]> {
  let input: Readable | undefined;
  const sheets: SheetData[] = [];
  let failure: unknown;
  let storedBytes = 0;
  try {
    input = Readable.from([await orderedArchive(bytes, Math.min(MAX_XML, maxExpandedBytes))], {
      objectMode: false,
    });
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
