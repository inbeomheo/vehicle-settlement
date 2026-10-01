'use client';
import { useState } from 'react';
import { DriverAssignments } from './driver-assignments';
import type { DriverProfile } from '@/server/services/driver-profiles';
import { Modal, ConfirmDialog } from '@/components/ui/modal';
import { DriverProfileEditor } from '@/components/driver-profile-editor';
import { DriverAffiliationEditor } from './driver-affiliation-editor';
import { DriverJoinLinks } from './driver-join-links';
import {
  Badge,
  Empty,
  Field,
  Heading,
  Notice,
  dateTime,
  inputClass,
  mutate,
  panelClass,
  secondaryClass,
  useRemote,
} from './common';
function tons(value: string | null | undefined) {
  if (value == null || value === '') return '—';
  return `${String(Number(value))}톤`;
}
export function Drivers() {
  const me = useRemote<{ role: string }>('/api/me');
  const rows = useRemote<DriverProfile[]>('/api/drivers');
  const [search, setSearch] = useState('');
  const [affiliationTarget, setAffiliationTarget] = useState<DriverProfile | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<DriverProfile | null>(null);
  const [editing, setEditing] = useState<DriverProfile | null>(null);
  const [statusTarget, setStatusTarget] = useState<DriverProfile | null>(null);
  const [resetTarget, setResetTarget] = useState<DriverProfile | null>(null);
  const [resetUrl, setResetUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const admin = me.data?.role === 'ADMIN';
  const canEditAffiliation = admin || me.data?.role === 'SETTLEMENT_MANAGER';
  const filtered =
    rows.data?.filter((row) =>
      [
        row.name,
        row.phone,
        row.login_id,
        row.business_name,
        row.biz_no,
        row.plate_no,
        ...row.projects.map((p) => p.name),
      ].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())),
    ) ?? [];
  const properties = (row: DriverProfile) => [
    row.phone ?? '—',
    row.business_name ?? '—',
    row.biz_no ?? '—',
    row.plate_no ?? '—',
    `${row.vehicle_type ?? '—'} · ${tons(row.tonnage)}`,
    row.projects.map((p) => p.name).join(', ') || (
      <span className="rounded border border-orange-200 bg-orange-50 px-2 py-1 font-semibold text-orange-800">
        현장 배정 필요
      </span>
    ),
    dateTime(row.created_at).slice(0, 10),
  ];
  const titles = ['전화번호', '상호', '사업자번호', '차량번호', '차종·톤수', '배정 현장', '가입일'];
  function actions(row: DriverProfile, compact = false) {
    return (
      canEditAffiliation && (
        <div
          className={
            compact
              ? 'grid grid-cols-2 gap-2 [&>button]:px-2 [&>button]:text-sm [&>button]:whitespace-normal [&>button:last-child]:col-span-2'
              : 'flex flex-wrap gap-2'
          }
        >
          <button
            className={secondaryClass}
            disabled={!row.affiliations.length}
            onClick={() => setAffiliationTarget(row)}
          >
            소속 시작일 수정
          </button>
          {admin && (
            <>
              <button className={secondaryClass} onClick={() => setAssignmentTarget(row)}>
                현장 배정
              </button>
              <button className={secondaryClass} onClick={() => setEditing(row)}>
                정보 수정
              </button>
              <button
                className={secondaryClass}
                onClick={() => {
                  setError('');
                  setStatusTarget(row);
                }}
              >
                {row.status === 'ACTIVE' ? '계정 끄기' : '계정 켜기'}
              </button>
              <button
                disabled={row.status !== 'ACTIVE' || busy}
                className={`${secondaryClass} whitespace-normal`}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const result = await mutate<{ reset_url?: string; message?: string }>(
                      `/api/admin/users/${row.id}/password-reset`,
                      'POST',
                      {},
                    );
                    if (!result.reset_url) throw new Error(result.message ?? '새 링크를 다시 만드세요.');
                    setResetTarget(row);
                    setResetUrl(result.reset_url);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : '링크를 만들지 못했습니다.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                비밀번호 재설정 링크
              </button>
            </>
          )}
        </div>
      )
    );
  }
  return (
    <>
      <Heading
        title="기사관리"
        description={
          admin
            ? '기사님의 현장 배정·정보·계정과 공용 가입 링크를 관리합니다.'
            : canEditAffiliation
              ? '기사 정보를 보고 소속 시작일을 수정할 수 있습니다. 그 밖의 정보 변경은 관리자에게 요청하세요.'
              : '기사 정보를 볼 수 있습니다. 정보 변경은 관리자에게 요청하세요.'
        }
      />
      <Notice
        error={statusTarget ? undefined : error || rows.error || me.error}
        success={success}
        onRetry={() => {
          rows.refresh();
          me.refresh();
        }}
      />
      {admin && <DriverJoinLinks />}
      <div className="mb-4 max-w-lg">
        <Field title="기사 검색">
          <input
            className={inputClass}
            value={search}
            placeholder="이름·전화·상호·차량·현장"
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
      </div>
      {rows.loading ? (
        <Empty loading />
      ) : !filtered.length ? (
        <Empty />
      ) : (
        <>
          <div className="grid gap-3 md:hidden" aria-label="기사 카드 목록">
            {filtered.map((row) => (
              <article key={row.id} className={`${panelClass} space-y-4`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-bold">{row.name}</h2>
                  <Badge value={row.status} />
                </div>
                <dl className="space-y-2">
                  {properties(row).map((value, index) => (
                    <div key={titles[index]} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-sm">
                      <dt className="text-slate-600">{titles[index]}</dt>
                      <dd className="break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
                {actions(row)}
              </article>
            ))}
          </div>
          <div className="hidden max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-slate-100">
                <tr>
                  {[
                    '기사 · 연락처',
                    '상호 · 사업자번호',
                    '차량 · 차종',
                    '배정 현장',
                    '가입일 · 상태',
                    ...(canEditAffiliation ? ['관리'] : []),
                  ].map((title) => (
                    <th key={title} className={`px-3 py-3 ${title === '관리' ? 'w-64' : ''}`}>
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-slate-200 ${admin ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                    onClick={admin ? () => setEditing(row) : undefined}
                  >
                    <td className="px-3 py-3 break-words font-semibold">
                      {admin ? (
                        <button
                          className="min-h-11 text-left underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(row);
                          }}
                        >
                          {row.name}
                        </button>
                      ) : (
                        row.name
                      )}
                      <span className="mt-1 block text-sm font-normal text-slate-600">
                        {row.phone ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 break-words">
                      {row.business_name ?? '—'}
                      <span className="mt-1 block text-slate-600">{row.biz_no ?? '—'}</span>
                    </td>
                    <td className="px-3 py-3 break-words">
                      {row.plate_no ?? '—'}
                      <span className="mt-1 block text-slate-600">
                        {row.vehicle_type ?? '—'} · {tons(row.tonnage)}
                      </span>
                    </td>
                    <td className="px-3 py-3 break-words">{properties(row)[5]}</td>
                    <td className="px-3 py-3 break-words">
                      <span className="mb-2 block">{dateTime(row.created_at).slice(0, 10)}</span>
                      <Badge value={row.status} />
                    </td>
                    {canEditAffiliation && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {actions(row, true)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {assignmentTarget && (
        <Modal title={`${assignmentTarget.name} 현장 배정`} onClose={() => setAssignmentTarget(null)}>
          <DriverAssignments userId={assignmentTarget.id} onChanged={rows.refresh} />
          <button type="button" className={secondaryClass} onClick={() => setAssignmentTarget(null)}>
            닫기
          </button>
        </Modal>
      )}
      {affiliationTarget && (
        <Modal
          title={`${affiliationTarget.name} 소속 시작일 수정`}
          onClose={() => setAffiliationTarget(null)}
        >
          <DriverAffiliationEditor
            profile={affiliationTarget}
            onClose={() => setAffiliationTarget(null)}
            onSaved={() => {
              setAffiliationTarget(null);
              rows.refresh();
              setSuccess('소속 시작일을 저장했습니다.');
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title={`${editing.name} 기사 정보 수정`} onClose={() => setEditing(null)}>
          <DriverAssignments userId={editing.id} onChanged={rows.refresh} />
          <DriverProfileEditor
            profile={editing}
            manager
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              rows.refresh();
              setSuccess('기사 정보를 저장했습니다.');
            }}
          />
        </Modal>
      )}
      {resetTarget && (
        <Modal title={`${resetTarget.name} 비밀번호 재설정`} onClose={() => setResetTarget(null)}>
          <div className="space-y-4">
            <Field title="비밀번호 재설정 링크">
              <input className={inputClass} readOnly value={resetUrl} onFocus={(e) => e.target.select()} />
            </Field>
            <p>이 링크를 본인에게 문자로 보내세요. 24시간 동안 한 번만 쓸 수 있습니다.</p>
            <button
              className={secondaryClass}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resetUrl);
                  setSuccess('링크를 복사했습니다.');
                  setResetTarget(null);
                } catch {
                  setError('링크를 길게 눌러 직접 복사하세요.');
                }
              }}
            >
              복사
            </button>
            <button type="button" className={secondaryClass} onClick={() => setResetTarget(null)}>
              닫기
            </button>
            <Notice error={error} />
          </div>
        </Modal>
      )}
      {statusTarget && (
        <ConfirmDialog
          title={statusTarget.status === 'ACTIVE' ? '계정을 끌까요?' : '계정을 켤까요?'}
          confirmLabel="계정 상태 변경"
          busy={busy}
          error={error}
          onClose={() => {
            setStatusTarget(null);
            setError('');
          }}
          onConfirm={async () => {
            setBusy(true);
            setError('');
            try {
              await mutate(`/api/admin/users/${statusTarget.id}`, 'PATCH', {
                version: statusTarget.version,
                status: statusTarget.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
              });
              setStatusTarget(null);
              rows.refresh();
              setSuccess('계정 상태를 변경했습니다.');
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '변경하지 못했습니다.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>{statusTarget.name} 기사님의 로그인 상태를 변경합니다. 과거 운행 기록은 보존됩니다.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
