import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { factories } from '../helpers/factories';
import { streamingRequest } from '../helpers/request-stream';
import { withDatabase } from '../../src/server/db/client';
import { POST as importRoute } from '../../src/app/api/import/upload/route';
import { readXlsx } from '../../src/server/services/import-file';
import { uploadImport } from '../../src/server/services/import';
const database = testDatabase();
async function workbook() {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('자료').addRow(['안전']);
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
function entry(bytes: Buffer, name = 'xl/sharedStrings.xml') {
  let offset = bytes.readUInt32LE(bytes.length - 6);
  while (bytes.readUInt32LE(offset) === 0x02014b50) {
    const length = bytes.readUInt16LE(offset + 28);
    if (bytes.subarray(offset + 46, offset + 46 + length).toString() === name)
      return { central: offset, local: bytes.readUInt32LE(offset + 42) };
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  throw new Error('entry missing');
}
describe('F9 XLSX', () => {
  it.each(['method', 'name', 'flags', 'compressed', 'expanded'] as const)(
    '로컬/중앙 %s 불일치 거부',
    async (field) => {
      const bytes = await workbook();
      const { local } = entry(bytes);
      if (field === 'name') bytes[local + 30] = 'z'.charCodeAt(0);
      else if (field === 'method') bytes.writeUInt16LE(0, local + 8);
      else if (field === 'flags') bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) ^ 2048, local + 6);
      else bytes.writeUInt32LE(1, local + (field === 'compressed' ? 18 : 22));
      await expect(readXlsx(bytes, -1, true)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
  it('R8 중앙 방식 STORE·크기를 위조해 로컬 DEFLATE 해제를 우회할 수 없다', async () => {
    const bytes = await workbook();
    const { central } = entry(bytes);
    bytes.writeUInt16LE(0, central + 10);
    bytes.writeUInt32LE(bytes.readUInt32LE(central + 20), central + 24);
    await expect(readXlsx(bytes, -1, true)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('실제 해제 누적량은 위조 헤더와 무관하게 작은 한도로 제한', async () => {
    const zip = await JSZip.loadAsync(await workbook());
    zip.file('padding.txt', 'x'.repeat(32 * 1024));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await expect(readXlsx(bytes, -1, true, 16 * 1024)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const { local, central } = entry(bytes, 'padding.txt');
    bytes.writeUInt32LE(1, local + 22);
    bytes.writeUInt32LE(1, central + 24);
    await expect(readXlsx(bytes, -1, true, 16 * 1024)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('정상 xlsx와 data descriptor xlsx 허용', async () => {
    const bytes = await workbook();
    expect((await readXlsx(bytes, -1, true))[0].rows[0]).toEqual(['안전']);
    const zip = await JSZip.loadAsync(bytes);
    const streamed = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      streamFiles: true,
    });
    expect((await readXlsx(streamed, -1, true))[0].rows[0]).toEqual(['안전']);
  });
  it('배정 없는 담당자는 가져오기 거부', async () => {
    const f = factories(database().db);
    const manager = await f.user({ role: 'SITE_MANAGER' });
    await expect(
      uploadImport(f.context(manager), '자료.csv', Buffer.from('현장\n서울')),
    ).rejects.toMatchObject({ status: 403 });
    const session = await f.session(manager.id);
    const input = streamingRequest(8, { cookie: `sid=${session.token}` });
    const response = await withDatabase(database().db, () =>
      importRoute(input.request, { params: Promise.resolve({}) }),
    );
    expect(response.status).toBe(403);
    expect(input.state().emitted).toBe(0);
  });
});
