import { EVIDENCE_MAX_BYTES, PDF_TOO_LARGE, IMAGE_TOO_LARGE } from '../../shared/upload-limits';
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string }> {
  if (file.type === 'application/pdf') {
    if (file.size > EVIDENCE_MAX_BYTES) throw new Error(PDF_TOO_LARGE);
    return { blob: file, name: file.name };
  }
  if (!file.type.startsWith('image/')) throw new Error('사진 또는 PDF 파일을 선택하세요.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('이 사진 형식을 변환할 수 없습니다. JPEG 또는 PNG 사진을 선택하세요.');
  }
  try {
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('사진을 변환하지 못했습니다.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('사진을 변환하지 못했습니다.'))),
        'image/jpeg',
        0.8,
      ),
    );
    if (blob.size > EVIDENCE_MAX_BYTES) throw new Error(IMAGE_TOO_LARGE);
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } finally {
    bitmap.close();
  }
}
