import type { UseDetail } from '@/client/types';
import type { PendingEvidence } from '@/client/offline/store';

export function evidenceError(
  policy: string | undefined,
  existing: UseDetail['evidence'],
  pending: PendingEvidence[],
) {
  if (!policy || policy === 'NONE') return '';
  const fileKinds = ['PHOTO', 'RECEIPT', 'WEIGH_TICKET', 'CONFIRMATION'];
  const alternativeKinds = ['SLIP_NO', 'CONFIRMATION'];
  const server = existing.filter((file) => !pending.some((next) => next.replacesId === file.id));
  const file =
    server.some((f) => f.upload_status === 'UPLOADED' && f.mime && fileKinds.includes(f.kind)) ||
    pending.some((f) => f.blob && fileKinds.includes(f.kind));
  const alternative =
    server.some(
      (f) => f.upload_status === 'UPLOADED' && f.text_value?.trim() && alternativeKinds.includes(f.kind),
    ) || pending.some((f) => f.text_value?.trim() && alternativeKinds.includes(f.kind));
  if (file || (policy === 'PHOTO_OR_ALTERNATIVE' && alternative)) return '';
  return policy === 'PHOTO_OR_ALTERNATIVE'
    ? '사진 또는 인수증을 1개 이상 첨부하거나 전표번호를 입력하세요'
    : '사진 또는 인수증을 1개 이상 첨부하세요';
}
