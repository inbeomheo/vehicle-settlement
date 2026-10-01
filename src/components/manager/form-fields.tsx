'use client';
import { useBusy } from '@/components/ui/use-busy';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, mutate } from '@/client/api';
import {
  defaultFieldModes,
  fieldKeys,
  fieldLabels,
  fieldModes,
  modeLabels,
  type AdminFieldSettings,
  type FieldSetting,
} from '@/shared/form-settings';
import {
  Field,
  Heading,
  Notice,
  inputClass,
  panelClass,
  secondaryClass,
  signalClass,
  useRemote,
} from './common';

const groups = [
  { key: 'use', label: '사용 정보', fields: fieldKeys.slice(0, 8) },
  { key: 'trips', label: '운행', fields: fieldKeys.slice(8, -1) },
  { key: 'costs', label: '비용', fields: fieldKeys.slice(-1) },
];
export function FormFieldSettings({ initialProject = '' }: { initialProject?: string }) {
  const projects = useRemote<{ id: string; name: string }[]>('/api/admin/projects');
  const [project, setProject] = useState(initialProject);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<AdminFieldSettings>();
  const [fields, setFields] = useState<FieldSetting[]>([]);
  const [attempt, setAttempt] = useState(0);
  const { busy, begin, end } = useBusy();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflict, setConflict] = useState<AdminFieldSettings>();
  useEffect(() => {
    const restore = () => {
      const candidate = new URLSearchParams(window.location.search).get('project');
      setProject(projects.data?.some((row) => row.id === candidate) ? candidate! : '');
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [projects.data]);
  function selectProject(value: string) {
    setProject(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('project', value);
    else url.searchParams.delete('project');
    window.history.pushState(null, '', url.pathname + url.search);
  }
  useEffect(() => {
    let alive = true;
    setSettings(undefined);
    setError('');
    setSuccess('');
    setConflict(undefined);
    void api<AdminFieldSettings>(`/api/admin/form-fields${project ? `?project_id=${project}` : ''}`)
      .then((data) => {
        if (alive) {
          setSettings(data);
          setFields(data.fields);
        }
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : '설정을 불러오지 못했습니다.');
      });
    return () => {
      alive = false;
    };
  }, [project, attempt]);
  function patch(key: FieldSetting['field_key'], values: Partial<FieldSetting>) {
    setFields((previous) => previous.map((row) => (row.field_key === key ? { ...row, ...values } : row)));
    setSuccess('');
  }
  const changed = fields.filter((row) => {
    const prior = settings?.fields.find((field) => field.field_key === row.field_key);
    return row.driver_mode !== prior?.driver_mode || row.manager_mode !== prior?.manager_mode;
  });
  const inherited =
    settings &&
    (project
      ? settings.company
      : { driver: defaultFieldModes('driver'), manager: defaultFieldModes('manager') });
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings || settings.project_id !== (project || null) || !changed.length) return;
    if (!begin()) return false;
    setError('');
    setSuccess('');
    try {
      const data = await mutate<AdminFieldSettings>(
        '/api/admin/form-fields',
        { project_id: project || null, fields: changed },
        crypto.randomUUID(),
        'PUT',
      );
      setSettings(data);
      setFields(data.fields);
      setConflict(undefined);
      setSuccess('입력 항목 설정을 저장했습니다. 변경 이력에 기록되었습니다.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '저장하지 못했습니다.');
      if (reason instanceof ApiError && reason.code === 'VERSION_CONFLICT')
        setConflict((reason.details as { current: AdminFieldSettings }).current);
    } finally {
      end();
    }
  }
  return (
    <>
      <Heading
        title="입력 항목 설정"
        description="항목마다 숨김·선택·필수를 누르고 저장하세요. 현장 설정이 회사 기본값보다 우선합니다."
      >
        <Link href="/m/master" className={secondaryClass}>
          기준정보 목록
        </Link>
        <Link href="/m/audit" className={secondaryClass}>
          변경 이력
        </Link>
      </Heading>
      <div className={`${panelClass} mb-4`}>
        <Field title="설정할 현장">
          <select
            className={inputClass}
            aria-label="설정할 현장"
            value={project}
            disabled={busy}
            onChange={(event) => selectProject(event.target.value)}
          >
            <option value="">회사 기본값</option>
            {projects.data?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="mt-3 text-sm text-slate-600">
          사용일·현장·차량·출발·도착·증빙은 항상 입력합니다. 나머지는 아래에서 숨김·선택·필수로 정하세요.
        </p>
      </div>
      <Notice error={error || projects.error} success={success} />
      {conflict && (
        <button
          className={`${secondaryClass} mb-4`}
          onClick={() => {
            setSettings(conflict);
            setFields(conflict.fields);
            setConflict(undefined);
            setError('');
          }}
        >
          최신 설정 불러오기 (현재 편집 초기화)
        </button>
      )}
      {!settings || settings.project_id !== (project || null) ? (
        <button className={secondaryClass} onClick={() => setAttempt((value) => value + 1)}>
          {error ? '다시 불러오기' : '설정을 불러오는 중…'}
        </button>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            {groups.map((group) => (
              <section key={group.key} aria-label={`${group.label} 그룹`}>
                <button
                  type="button"
                  className={`${secondaryClass} mb-3 w-full justify-between md:hidden`}
                  aria-expanded={!!openGroups[group.key]}
                  aria-controls={`field-group-${group.key}`}
                  onClick={() =>
                    setOpenGroups((previous) => ({ ...previous, [group.key]: !previous[group.key] }))
                  }
                >
                  {group.label} · {group.fields.length}개 {openGroups[group.key] ? '접기 −' : '펼치기 +'}
                </button>
                <h2 className="mb-3 hidden font-bold md:block">{group.label}</h2>
                <div
                  id={`field-group-${group.key}`}
                  className={`${openGroups[group.key] ? 'grid' : 'hidden'} min-w-0 gap-3 md:grid`}
                >
                  <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <div className="hidden grid-cols-[minmax(8rem,1fr)_minmax(0,17rem)_minmax(0,17rem)] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 md:grid">
                      <span>항목</span>
                      <span>기사 화면</span>
                      <span>담당자 화면</span>
                    </div>
                    {fields
                      .filter((row) => group.fields.includes(row.field_key))
                      .map((row) => (
                        <section
                          key={row.field_key}
                          aria-label={`${fieldLabels[row.field_key]} 설정`}
                          className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(8rem,1fr)_minmax(0,17rem)_minmax(0,17rem)] md:items-center md:gap-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{fieldLabels[row.field_key]}</h3>
                            {(row.driver_mode || row.manager_mode) && (
                              <button
                                type="button"
                                className="text-xs font-semibold text-blue-700 underline underline-offset-2"
                                onClick={() =>
                                  patch(row.field_key, { driver_mode: null, manager_mode: null })
                                }
                              >
                                {project ? '재정의 해제' : '기본값으로'}
                              </button>
                            )}
                          </div>
                          {(['driver', 'manager'] as const).map((role) => {
                            const name = `${fieldLabels[row.field_key]} · ${role === 'driver' ? '기사' : '담당자'}`;
                            const explicit = row[`${role}_mode`];
                            const effective = explicit ?? inherited![role][row.field_key];
                            return (
                              <div key={role} className="min-w-0">
                                <span className="mb-1 block text-xs text-slate-500 md:hidden">
                                  {role === 'driver' ? '기사 화면' : '담당자 화면'}
                                  {!explicit && ` · ${project ? '회사 기본 따름' : '기본값'}`}
                                </span>
                                <div
                                  role="radiogroup"
                                  aria-label={name}
                                  className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1"
                                >
                                  {fieldModes.map((mode) => {
                                    const on = effective === mode;
                                    const tone =
                                      mode === 'REQUIRED'
                                        ? 'bg-ink text-white'
                                        : mode === 'OPTIONAL'
                                          ? 'bg-white text-blue-800 shadow-sm'
                                          : 'bg-slate-500 text-white';
                                    return (
                                      <label
                                        key={mode}
                                        className={`relative flex min-h-11 cursor-pointer items-center justify-center rounded-md text-sm font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-blue-700 ${on ? tone : 'text-slate-500 hover:text-ink'} ${on && !explicit ? 'ring-1 ring-slate-300 ring-inset' : ''}`}
                                      >
                                        <input
                                          type="radio"
                                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                          name={`${row.field_key}-${role}`}
                                          value={mode}
                                          checked={on}
                                          onChange={() => patch(row.field_key, { [`${role}_mode`]: mode })}
                                        />
                                        {modeLabels[mode]}
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                          {(row.driver_mode ?? inherited!.driver[row.field_key]) === 'HIDDEN' &&
                            !!settings.pending_fixes[row.field_key] && (
                              <p
                                role="alert"
                                className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 md:col-span-3"
                              >
                                미해결 보완요청이 {settings.pending_fixes[row.field_key]}건 있습니다. 숨김으로
                                저장해도 해당 기사는 보완을 마칠 수 있도록 이 항목이 표시됩니다.
                              </p>
                            )}
                        </section>
                      ))}
                  </div>
                </div>
              </section>
            ))}
          </fieldset>
          <section className={panelClass} aria-label="기사 폼 미리보기">
            <h2 className="font-bold">기사 폼 미리보기</h2>
            <p className="mt-2 text-sm text-slate-600">현재 편집 중인 설정으로 보일 항목입니다.</p>
            <p className="mt-3">사용일 · 현장 · 차량 · 출발 · 도착 · 청구수량 · 증빙</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {fieldKeys.map((key) => {
                const mode =
                  fields.find((row) => row.field_key === key)?.driver_mode ?? inherited!.driver[key];
                return mode === 'HIDDEN' ? null : (
                  <li key={key} className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    {fieldLabels[key]} · {modeLabels[mode]}
                  </li>
                );
              })}
            </ul>
          </section>
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
            <button className={signalClass} disabled={busy || !changed.length || !!conflict}>
              {busy ? '저장 중…' : '설정 저장'}
            </button>
            <span className="text-sm text-slate-600">
              {changed.length ? `변경한 항목 ${changed.length}개 · 저장 후 적용` : '저장된 설정입니다.'}
            </span>
          </div>
        </form>
      )}
    </>
  );
}
