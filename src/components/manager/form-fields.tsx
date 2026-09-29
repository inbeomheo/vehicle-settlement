'use client';
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
  type FieldMode,
} from '@/shared/form-settings';
import {
  Field,
  Heading,
  Notice,
  buttonClass,
  inputClass,
  panelClass,
  secondaryClass,
  useRemote,
} from './common';

const groups = [
  { key: 'use', label: '사용 정보', fields: fieldKeys.slice(0, 6) },
  { key: 'trips', label: '운행', fields: fieldKeys.slice(6, -1) },
  { key: 'costs', label: '비용', fields: fieldKeys.slice(-1) },
];
export function FormFieldSettings({ initialProject = '' }: { initialProject?: string }) {
  const projects = useRemote<{ id: string; name: string }[]>('/api/admin/projects');
  const [project, setProject] = useState(initialProject);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<AdminFieldSettings>();
  const [fields, setFields] = useState<FieldSetting[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
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
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="입력 항목 설정"
        description="기사와 담당자가 입력할 항목을 정하세요. 현장 설정이 회사 기본값보다 우선합니다."
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
          사용일·현장·차량·출발·도착(운행 1건 이상), 과금에 필요한 청구수량, 현장 증빙 정책은 항상 적용됩니다.
          기사와 차량은 본인 기본값을 사용합니다.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          수량·시간은 운행 기록입니다. 청구수량은 별도로 입력합니다. 추가 비용을 필수로 정하면 추가비 1건
          이상이 필요하며, 공차회차는 ‘아님’도 유효한 값입니다.
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
                  className={`${openGroups[group.key] ? 'grid' : 'hidden'} min-w-0 gap-3 md:grid lg:grid-cols-2`}
                >
                  {fields
                    .filter((row) => group.fields.includes(row.field_key))
                    .map((row) => (
                      <section
                        key={row.field_key}
                        className={panelClass}
                        aria-label={`${fieldLabels[row.field_key]} 설정`}
                      >
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-bold">{fieldLabels[row.field_key]}</h3>
                          {project && (row.driver_mode || row.manager_mode) && (
                            <button
                              type="button"
                              className={secondaryClass}
                              onClick={() => patch(row.field_key, { driver_mode: null, manager_mode: null })}
                            >
                              재정의 해제
                            </button>
                          )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {(['driver', 'manager'] as const).map((role) => (
                            <Field
                              key={role}
                              title={`${fieldLabels[row.field_key]} · ${role === 'driver' ? '기사' : '담당자'}`}
                            >
                              <select
                                className={inputClass}
                                aria-label={`${fieldLabels[row.field_key]} · ${role === 'driver' ? '기사' : '담당자'}`}
                                value={row[`${role}_mode`] ?? ''}
                                onChange={(event) =>
                                  patch(row.field_key, {
                                    [`${role}_mode`]: (event.target.value as FieldMode) || null,
                                  })
                                }
                              >
                                <option value="">
                                  {project ? '회사 기본 따름' : '초기 기본값'} ·{' '}
                                  {modeLabels[inherited![role][row.field_key]]}
                                </option>
                                {fieldModes.map((mode) => (
                                  <option key={mode} value={mode}>
                                    {modeLabels[mode]}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          ))}
                        </div>
                        {(row.driver_mode ?? inherited!.driver[row.field_key]) === 'HIDDEN' &&
                          !!settings.pending_fixes[row.field_key] && (
                            <p
                              role="alert"
                              className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
                            >
                              미해결 보완요청이 {settings.pending_fixes[row.field_key]}건 있습니다. 숨김으로
                              저장해도 해당 기사는 보완을 마칠 수 있도록 이 항목이 표시됩니다.
                            </p>
                          )}
                      </section>
                    ))}
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
          <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white p-4">
            <button className={buttonClass} disabled={busy || !changed.length || !!conflict}>
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
