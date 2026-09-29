import { api, ApiError } from './api';
import type { UseDetail } from './types';
import { copyValues } from '@/components/use-form/model';
import { cacheValue, cachedValue, putDraft, type Draft } from './offline/store';

export async function copyToDevice(userId: string, id: string) {
  let source: UseDetail | undefined;
  try {
    source = await api<UseDetail>(`/api/uses/${id}`);
    await cacheValue(userId, `use:${id}`, source);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    source = await cachedValue<UseDetail>(userId, `use:${id}`);
  }
  if (!source) throw new Error('연결 후 원본 운행을 열어 주세요.');
  const draft: Draft = {
    id: crypto.randomUUID(),
    userId,
    mode: 'driver',
    form: copyValues(source, 'driver'),
    uploads: [],
    updatedAt: Date.now(),
    phase: 'editing',
  };
  await putDraft(draft);
  return `/d/new?draft=${draft.id}`;
}
