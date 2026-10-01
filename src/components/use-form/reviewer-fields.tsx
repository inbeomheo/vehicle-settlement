'use client';
import { useContext, useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import { api, ApiError } from '@/client/api';
import { cacheValue, cachedValue } from '@/client/offline/store';
import type { getUseReviewers } from '@/server/services/use-reviewers';
import type { FormValues } from './model';
import { button, control, ChoiceChips, Field, SettingsContext } from './fields';

type Options = Awaited<ReturnType<typeof getUseReviewers>>;
const roles = {
  ADMIN: '관리자',
  SITE_MANAGER: '현장 담당자',
  SETTLEMENT_MANAGER: '정산 담당자',
  DRIVER: '기사',
};
export function useReviewerOptions(userId: string, projectId?: string, driverId?: string) {
  const key = `reviewers:${projectId}:${driverId}`;
  const [state, setState] = useState<{ key: string; data?: Options; notice: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!projectId || !driverId) return;
    const apply = (data: Options | undefined, notice = '') => {
      if (alive) setState({ key, data, notice });
    };
    void api<Options>(`/api/uses/reviewers?project_id=${projectId}&driver_id=${driverId}`)
      .then(async (data) => {
        await cacheValue(userId, key, data).catch(() => {});
        apply(data);
      })
      .catch(async (error: unknown) => {
        if (error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) {
          apply(undefined, '담당자 목록을 확인할 권한이 없습니다.');
          return;
        }
        const data = await cachedValue<Options>(userId, key).catch(() => undefined);
        apply(
          data,
          data
            ? '저장된 담당자 목록입니다. 보내기 전에 현재 권한을 다시 확인합니다.'
            : '담당자 목록을 불러오지 못했습니다. 연결 후 다시 확인하세요.',
        );
      });
    return () => {
      alive = false;
    };
  }, [userId, projectId, driverId, key, attempt]);
  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, []);
  return {
    data: state?.key === key ? state.data : undefined,
    notice: state?.key === key ? state.notice : '담당자 목록을 불러오고 있습니다…',
    retry: () => setAttempt((value) => value + 1),
  };
}
export function ReviewerFields({
  form,
  change,
  options,
  tonnage,
}: {
  form: FormValues;
  change: (patch: Partial<FormValues>) => void;
  options: ReturnType<typeof useReviewerOptions>;
  tonnage?: string | null;
}) {
  const modes = useContext(SettingsContext);
  const loads = [
    ...new Set(
      [tonnage, ...(options.data?.recent_loads ?? [])]
        .filter((v): v is string => !!v)
        .filter((value) => new Decimal(value).gt(0) && new Decimal(value).decimalPlaces() <= 1)
        .map((value) => new Decimal(value).toFixed()),
    ),
  ];
  return (
    <>
      <Field label="담당자" target="reviewer" group>
        <ChoiceChips
          name="reviewer_user_id"
          value={form.reviewer_user_id ?? ''}
          onChange={(reviewer_user_id) => change({ reviewer_user_id })}
          choices={[
            ...(options.data?.reviewers ?? []).map((user) => ({
              value: user.id,
              name: `${user.name} (${roles[user.role]})`,
              label: (
                <span className="break-words">
                  {user.name}
                  <span className="block text-sm font-normal">{roles[user.role]}</span>
                </span>
              ),
            })),
            { value: '', name: '담당자 미지정', label: '미지정' },
          ]}
        />
      </Field>
      {modes.reviewer !== 'HIDDEN' && options.notice && (
        <p aria-live="polite" className="text-sm">
          {options.notice}
          <button type="button" className={button} onClick={options.retry}>
            다시 확인
          </button>
        </p>
      )}
      {modes.reviewer !== 'HIDDEN' && options.data?.reviewers.length === 0 && (
        <p>선택할 수 있는 담당자가 없습니다. 관리자에게 현장 배정을 요청하세요.</p>
      )}
      <Field label="적재용량 (톤)" target="load_tonnage">
        <input
          className={control}
          type="text"
          inputMode="decimal"
          value={form.load_tonnage ?? ''}
          placeholder="예: 2.5"
          onChange={(event) => {
            if (/^\d{0,7}(\.\d?)?$/.test(event.target.value)) change({ load_tonnage: event.target.value });
          }}
        />
      </Field>
      {modes.load_tonnage !== 'HIDDEN' && loads.length > 0 && (
        <div role="group" aria-label="자주 쓰는 적재용량" className="flex flex-wrap gap-2">
          {loads.map((value) => (
            <button
              key={value}
              type="button"
              className={button}
              onClick={() => change({ load_tonnage: value })}
            >
              {value}톤{tonnage && new Decimal(value).eq(tonnage) ? ' (차량)' : ''}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
