'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/client/api';
import { cachedValue, cacheValue } from '@/client/offline/store';
import { defaultFieldModes, type EffectiveFieldSettings } from '@/shared/form-settings';

export function useFormSettings(userId: string, projectId: string | undefined, mode: 'driver' | 'manager') {
  const [resolved, setResolved] = useState<{ key: string; data: EffectiveFieldSettings; notice: string }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [attempt, setAttempt] = useState(0);
  const key = `${userId}:${mode}:${projectId ?? ''}`;
  const load = useCallback(async () => {
    if (!projectId) throw new Error('현장을 선택하세요.');
    const cacheKey = `form-settings:${mode}:${projectId}`;
    try {
      const data = await api<EffectiveFieldSettings>(`/api/form-settings?project_id=${projectId}`);
      // A full storage device must not turn a successful server lookup into an error.
      await cacheValue(userId, cacheKey, data).catch(() => {});
      return { key, data, notice: '' };
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) throw error;
      const cached = await cachedValue<EffectiveFieldSettings>(userId, cacheKey).catch(() => undefined);
      return {
        key,
        data: cached ?? { project_id: projectId, modes: defaultFieldModes(mode) },
        notice: cached
          ? '마지막으로 받은 입력 항목 설정을 사용합니다. 제출 시 서버에서 다시 확인합니다.'
          : '저장된 입력 항목 설정이 없어 기본 화면을 사용합니다. 연결 후 제출 시 다시 확인합니다.',
      };
    }
  }, [key, projectId, mode, userId]);
  useEffect(() => {
    let alive = true;
    setFailure(undefined);
    if (projectId)
      void load()
        .then((value) => {
          if (alive) setResolved(value);
        })
        .catch((error) => {
          if (alive)
            setFailure({
              key,
              message: error instanceof Error ? error.message : '입력 항목 설정을 불러오지 못했습니다.',
            });
        });
    return () => {
      alive = false;
    };
  }, [load, key, projectId, attempt]);
  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, []);
  return {
    modes: resolved?.key === key ? resolved.data.modes : defaultFieldModes(mode),
    ready: !projectId || (resolved?.key === key && failure?.key !== key),
    notice: !projectId
      ? '현장을 선택하세요.'
      : failure?.key === key
        ? failure.message
        : resolved?.key === key
          ? resolved.notice
          : '입력 항목 설정을 불러오고 있습니다…',
    retry: () => setAttempt((value) => value + 1),
    async refresh() {
      const value = await load();
      setResolved(value);
      setFailure(undefined);
      return value.data.modes;
    },
  };
}
