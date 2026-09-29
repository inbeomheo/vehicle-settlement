import type { UseDetail } from '@/client/types';
import type { PendingEvidence } from '@/client/offline/store';

export function evidenceRequirement(policy: string | undefined) {
  if (!policy || policy === 'NONE') return '';
  return `사진·인수증·계근표·확인서 중 1개 이상${policy === 'PHOTO_OR_ALTERNATIVE' ? ' 또는 전표번호' : ''}`;
}

export function evidenceInstruction(policy: string | undefined) {
  const requirement = evidenceRequirement(policy);
  return requirement ? `${requirement}${policy === 'PHOTO_OR_ALTERNATIVE' ? '를' : '을'} 등록하세요.` : '';
}

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
  return evidenceInstruction(policy);
}
