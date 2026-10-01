'use client';
import { useBusy } from '@/components/ui/use-busy';
import { useState } from 'react';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ui/modal';
import {
  Badge,
  Empty,
  Field,
  Heading,
  Notice,
  buttonClass,
  dateTime,
  inputClass,
  label,
  mutate,
  panelClass,
  secondaryClass,
  useRemote,
} from './common';
type Assignment = {
  id: string;
  project_id: string;
  valid_from: string;
  valid_to: string | null;
  revoked_at: string | null;
};
type User = {
  id: string;
  name: string;
  login_id: string;
  phone: string | null;
  role: string;
  driver_id: string | null;
  all_projects: boolean;
  status: string;
  version: number;
  assignments: Assignment[];
};
type Invite = {
  id: string;
  name: string;
  role: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};
type Option = { id: string; name: string };
const roles = ['DRIVER', 'SITE_MANAGER', 'SETTLEMENT_MANAGER', 'ADMIN'];
export function Users() {
  const users = useRemote<User[]>('/api/admin/users');
  const invites = useRemote<Invite[]>('/api/invites');
  const lookups = useRemote<{ projects: Option[]; drivers: Option[] }>('/api/lookups');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { busy, begin, end } = useBusy();
  const [cancelInvite, setCancelInvite] = useState<Invite | null>(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [resetLink, setResetLink] = useState<{ userId: string; url: string } | null>(null);
  const [inviteRole, setInviteRole] = useState('SITE_MANAGER');
  const [projects, setProjects] = useState<string[]>([]);
  const [selected, setSelected] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const [editRole, setEditRole] = useState('SITE_MANAGER');
  const availableDrivers = (lookups.data?.drivers ?? []).filter(
    (driver) => users.data && !users.data.some((user) => user.driver_id === driver.id),
  );
  const run = async (action: () => Promise<unknown>, message: string) => {
    setError('');
    setSuccess('');
    if (!begin()) return false;
    try {
      await action();
      setSuccess(message);
      users.refresh();
      invites.refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '처리하지 못했습니다.');
      return false;
    } finally {
      end();
    }
  };
  return (
    <>
      <Heading title="사용자 관리" description="초대·역할·현장 배정 및 계정 상태를 관리합니다.">
        <Link href="/m/drivers" className={secondaryClass}>
          기사관리 · 가입 링크
        </Link>
      </Heading>
      <Notice
        error={cancelInvite ? undefined : error || users.error || invites.error || lookups.error}
        success={success}
        onRetry={
          users.error || invites.error || lookups.error
            ? () => {
                users.refresh();
                invites.refresh();
                lookups.refresh();
              }
            : undefined
        }
      />
      {!users.error && (
        <>
          <details className={`${panelClass} mb-5`}>
            <summary className="cursor-pointer text-lg font-bold">사용자 초대 생성</summary>
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void run(async () => {
                  const result = await mutate<{ invite_url: string }>('/api/invites', 'POST', {
                    role: inviteRole,
                    name: form.get('name'),
                    phone: form.get('phone') || undefined,
                    driver_id: inviteRole === 'DRIVER' ? form.get('driver_id') || undefined : undefined,
                    project_ids: projects,
                  });
                  setInviteUrl(result.invite_url);
                }, '초대를 생성했습니다. 링크를 복사하여 전달하세요.');
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field title="초대 역할">
                  <select
                    className={inputClass}
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {label(role)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field title="초대 이름">
                  <input className={inputClass} name="name" required maxLength={100} />
                </Field>
                <Field title="초대 연락처">
                  <input className={inputClass} name="phone" type="tel" maxLength={100} />
                </Field>
                {inviteRole === 'DRIVER' && (
                  <Field title="기사 연결 (선택)">
                    <select
                      className={inputClass}
                      name="driver_id"
                      disabled={users.loading || lookups.loading}
                    >
                      <option value="">가입할 때 기사 정보 직접 입력</option>
                      {availableDrivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
              {inviteRole === 'DRIVER' && (
                <div className="mt-3 text-sm text-slate-600">
                  <p>
                    선택하지 않으면 가입할 때 사업자·차량 정보를 직접 입력합니다. 기존 연결은 계정 없는 기사만
                    선택할 수 있습니다.
                  </p>
                  <Link
                    href="/m/master/drivers"
                    className="inline-flex min-h-11 items-center font-semibold text-blue-800 underline"
                  >
                    새 기사 먼저 등록
                  </Link>
                </div>
              )}
              <fieldset className="mt-4">
                <legend className="mb-2 text-sm font-semibold">현장 배정</legend>
                <div className="flex flex-wrap gap-4">
                  {lookups.data?.projects.map((project) => (
                    <label key={project.id} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        className="h-5 w-5"
                        type="checkbox"
                        checked={projects.includes(project.id)}
                        onChange={(e) =>
                          setProjects(
                            e.target.checked
                              ? [...projects, project.id]
                              : projects.filter((id) => id !== project.id),
                          )
                        }
                      />
                      {project.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button className={`${buttonClass} mt-4`} disabled={busy}>
                초대 링크 생성
              </button>
            </form>
          </details>
          {inviteUrl && (
            <section className={`${panelClass} mb-5 border-blue-200`}>
              <Field title="새 초대 링크 (7일·1회 사용)">
                <input className={inputClass} readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
              </Field>
              <button
                className={`${secondaryClass} mt-3`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteUrl);
                    setSuccess('초대 링크를 복사했습니다.');
                  } catch {
                    setError('링크를 선택한 뒤 직접 복사하세요.');
                  }
                }}
              >
                초대 링크 복사
              </button>
            </section>
          )}
          {selected && (
            <section key={selected.id} className={`${panelClass} mb-5`}>
              <h2 className="mb-4 text-lg font-bold">{selected.name} 관리</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(async () => {
                    await mutate(`/api/admin/users/${selected.id}`, 'PATCH', {
                      version: selected.version,
                      name: form.get('name'),
                      phone: form.get('phone') || null,
                      role: editRole,
                      driver_id: form.get('driver_id') || null,
                      all_projects: form.get('all_projects') === 'on',
                      status: form.get('status'),
                    });
                    setSelected(null);
                  }, '사용자 정보를 변경했습니다. 비활성 계정의 세션은 즉시 폐기됩니다.');
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field title="이름">
                    <input name="name" className={inputClass} defaultValue={selected.name} required />
                  </Field>
                  <Field title="연락처">
                    <input
                      name="phone"
                      type="tel"
                      className={inputClass}
                      defaultValue={selected.phone ?? ''}
                    />
                  </Field>
                  <Field title="역할">
                    <select
                      className={inputClass}
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {label(role)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field title="연결 기사">
                    <select
                      name="driver_id"
                      className={inputClass}
                      required={editRole === 'DRIVER'}
                      defaultValue={selected.driver_id ?? ''}
                    >
                      <option value="">없음</option>
                      {lookups.data?.drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field title="계정 상태">
                    <select name="status" className={inputClass} defaultValue={selected.status}>
                      <option value="ACTIVE">활성</option>
                      <option value="DISABLED">비활성 (즉시 세션 폐기)</option>
                    </select>
                  </Field>
                  {['ADMIN', 'SETTLEMENT_MANAGER'].includes(editRole) && (
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        className="h-5 w-5"
                        name="all_projects"
                        type="checkbox"
                        defaultChecked={selected.all_projects}
                      />
                      모든 현장 접근
                    </label>
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  <button className={buttonClass} disabled={busy}>
                    변경 저장
                  </button>
                  <button
                    className={secondaryClass}
                    disabled={busy}
                    type="button"
                    onClick={() => setSelected(null)}
                  >
                    닫기
                  </button>
                </div>
              </form>
              <h3 className="mt-6 mb-3 font-bold">현장 배정 내역</h3>
              {selected.assignments.map((assignment) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-3 text-sm"
                  key={assignment.id}
                >
                  <span>
                    {lookups.data?.projects.find((p) => p.id === assignment.project_id)?.name ??
                      assignment.project_id}{' '}
                    · {assignment.valid_from} ~ {assignment.valid_to ?? '종료 없음'}{' '}
                    {assignment.revoked_at ? '· 회수됨' : ''}
                  </span>
                  {!assignment.revoked_at && (
                    <button
                      className={secondaryClass}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await mutate(`/api/admin/assignments/${assignment.id}`, 'DELETE');
                          setSelected({
                            ...selected,
                            assignments: selected.assignments.map((a) =>
                              a.id === assignment.id ? { ...a, revoked_at: new Date().toISOString() } : a,
                            ),
                          });
                        }, '현장 배정을 회수했습니다. 해당 현장 접근이 즉시 차단됩니다.')
                      }
                    >
                      배정 회수
                    </button>
                  )}
                </div>
              ))}
              <form
                className="mt-3 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(async () => {
                    const assignment = await mutate<Assignment>('/api/admin/assignments', 'POST', {
                      user_id: selected.id,
                      project_id: form.get('project_id'),
                      valid_from: form.get('valid_from'),
                      valid_to: form.get('valid_to') || null,
                    });
                    setSelected({ ...selected, assignments: [...selected.assignments, assignment] });
                  }, '현장을 배정했습니다.');
                }}
              >
                <Field title="추가 배정 현장">
                  <select className={inputClass} name="project_id" required>
                    <option value="">선택하세요</option>
                    {lookups.data?.projects.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field title="배정 시작일">
                  <input
                    type="date"
                    className={inputClass}
                    name="valid_from"
                    required
                    defaultValue={new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}
                  />
                </Field>
                <Field title="배정 종료일">
                  <input type="date" className={inputClass} name="valid_to" />
                </Field>
                <button className={buttonClass} disabled={busy}>
                  현장 배정 추가
                </button>
              </form>
            </section>
          )}
          <div className="mb-4 max-w-md">
            <Field title="사용자 검색">
              <input
                className={inputClass}
                placeholder="이름·아이디·연락처"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-3">
            {users.data
              ?.filter((user) => `${user.name} ${user.login_id} ${user.phone}`.includes(search))
              .map((user) => (
                <article key={user.id} className={panelClass}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <strong>{user.name}</strong>
                      <span className="ml-2 text-sm text-slate-600">
                        {user.login_id} · {label(user.role)}
                      </span>
                      <p className="mt-2 text-sm text-slate-600">
                        {user.phone ?? '연락처 없음'} ·{' '}
                        {user.all_projects
                          ? '모든 현장 접근'
                          : `배정 ${user.assignments.filter((a) => !a.revoked_at).length}건`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge value={user.status} />
                      <button
                        className={secondaryClass}
                        disabled={busy}
                        onClick={() => {
                          setSelected(user);
                          setEditRole(user.role);
                          setError('');
                        }}
                      >
                        사용자 관리
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 break-all text-xs text-slate-600">사용자 ID: {user.id}</p>
                  <button
                    className={`${secondaryClass} mt-3 max-w-full whitespace-normal`}
                    disabled={busy || user.status !== 'ACTIVE'}
                    onClick={() => {
                      setResetLink(null);
                      void run(async () => {
                        const result = await mutate<{ reset_url?: string; message?: string }>(
                          `/api/admin/users/${user.id}/password-reset`,
                          'POST',
                        );
                        if (!result.reset_url) throw new Error(result.message ?? '새 링크를 다시 만드세요.');
                        setResetLink({ userId: user.id, url: result.reset_url });
                      }, '비밀번호 재설정 링크를 만들었습니다.');
                    }}
                  >
                    비밀번호 재설정 링크 만들기
                  </button>
                  {resetLink?.userId === user.id && (
                    <div className="mt-4 space-y-3">
                      <Field title="비밀번호 재설정 링크">
                        <input
                          className={inputClass}
                          readOnly
                          value={resetLink.url}
                          onFocus={(event) => event.target.select()}
                        />
                      </Field>
                      <p className="text-sm text-slate-600">
                        이 링크를 본인에게 문자로 보내세요. 24시간 동안 한 번만 쓸 수 있습니다.
                      </p>
                      <button
                        className={secondaryClass}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(resetLink.url);
                            setSuccess('링크를 복사했습니다.');
                          } catch {
                            setError('링크를 선택한 뒤 직접 복사하세요.');
                          }
                        }}
                      >
                        복사
                      </button>
                    </div>
                  )}
                </article>
              ))}
          </div>
          {users.loading && <Empty loading />}
          {!users.loading && !users.data?.length && <Empty>등록된 사용자가 없습니다.</Empty>}
          <section className={`${panelClass} mt-6`}>
            <h2 className="mb-3 text-lg font-bold">초대 이력</h2>
            {invites.data?.map((invite) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-3"
                key={invite.id}
              >
                <div>
                  <p className="text-sm font-semibold">
                    {invite.name} · {label(invite.role)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    만료 {dateTime(invite.expires_at)} ·{' '}
                    {invite.used_at
                      ? '사용 완료'
                      : invite.revoked_at
                        ? '취소됨'
                        : new Date(invite.expires_at) < new Date()
                          ? '만료됨'
                          : '수락 대기'}
                  </p>
                </div>
                {!invite.used_at && !invite.revoked_at && new Date(invite.expires_at) > new Date() && (
                  <button
                    className={secondaryClass}
                    disabled={busy}
                    onClick={() => {
                      setError('');
                      setCancelInvite(invite);
                    }}
                  >
                    초대 취소
                  </button>
                )}
              </div>
            ))}
            {invites.data && !invites.data.length && (
              <Empty loading={invites.loading}>초대 내역이 없습니다.</Empty>
            )}
          </section>
        </>
      )}
      {cancelInvite && (
        <ConfirmDialog
          title="초대 취소 확인"
          confirmLabel="초대 취소"
          busy={busy}
          error={error}
          onClose={() => setCancelInvite(null)}
          onConfirm={() =>
            void run(() => mutate(`/api/invites/${cancelInvite.id}`, 'DELETE'), '초대를 취소했습니다.').then(
              (ok) => {
                if (ok) setCancelInvite(null);
              },
            )
          }
        >
          <p>
            {cancelInvite.name} · {label(cancelInvite.role)} 초대 1건을 취소합니다.
          </p>
          <p>기존 초대 링크는 사용할 수 없으며 복구할 수 없습니다. 필요하면 새 초대를 생성하세요.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
