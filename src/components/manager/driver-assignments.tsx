'use client';
import { useState } from 'react';
import { todaySeoul } from '@/client/types';
import { useBusy } from '@/components/ui/use-busy';
import { Empty, Notice, mutate, secondaryClass, useRemote } from './common';

type Assignment = {
  id: string;
  user_id: string;
  project_id: string;
  valid_from: string;
  valid_to: string | null;
  revoked_at: string | null;
};
export function DriverAssignments({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const remote = useRemote<Assignment[]>('/api/admin/assignments');
  const projects = useRemote<{ projects: { id: string; name: string }[] }>('/api/lookups');
  const [saved, setSaved] = useState<Assignment[]>();
  const [pending, setPending] = useState<{ ids: string[]; checked: boolean }>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { busy, begin, end } = useBusy();
  const today = todaySeoul();
  const current = (saved ?? remote.data ?? []).filter(
    (a) =>
      a.user_id === userId && !a.revoked_at && a.valid_from <= today && (!a.valid_to || a.valid_to >= today),
  );
  const upcoming = (saved ?? remote.data ?? []).filter(
    (a) => a.user_id === userId && !a.revoked_at && a.valid_from > today,
  );
  const ready = !!remote.data && !!projects.data;
  async function change(projectIds: string[], checked: boolean) {
    if (!ready || !begin()) return;
    setError('');
    setSuccess('');
    setPending({ ids: projectIds, checked });
    let next = [...(saved ?? remote.data ?? [])];
    try {
      for (const projectId of projectIds) {
        const existing = current.filter((a) => a.project_id === projectId);
        const reserved = upcoming.filter((a) => a.project_id === projectId);
        if (checked && !existing.length) {
          // 미래 예약 배정이 있으면 오늘부터 배정과 기간이 겹치므로 먼저 회수한다.
          for (const assignment of reserved) {
            const revoked = await mutate<Assignment>(`/api/admin/assignments/${assignment.id}`, 'DELETE');
            next = next.map((a) => (a.id === revoked.id ? revoked : a));
          }
          const assignment = await mutate<Assignment>('/api/admin/assignments', 'POST', {
            user_id: userId,
            project_id: projectId,
            valid_from: today,
          });
          next.push(assignment);
        } else if (!checked) {
          for (const assignment of [...existing, ...reserved]) {
            const revoked = await mutate<Assignment>(`/api/admin/assignments/${assignment.id}`, 'DELETE');
            next = next.map((a) => (a.id === revoked.id ? revoked : a));
          }
        }
        setSaved([...next]);
      }
      setSuccess(checked ? '현장을 배정했어요.' : '현장 배정을 해제했어요.');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '배정을 바꾸지 못했습니다. 현재 배정을 다시 확인해 주세요.',
      );
      setSaved(undefined);
      remote.refresh();
    } finally {
      setPending(undefined);
      onChanged();
      end();
    }
  }
  return (
    <section className="mb-5 space-y-3" aria-label="배정 현장 관리">
      <h3 className="font-bold">배정 현장</h3>
      <p className="text-sm text-slate-600">
        기사님이 운행할 현장을 체크하세요. 체크를 바꾸면 바로 저장됩니다.
      </p>
      <Notice
        error={error || remote.error || projects.error}
        success={success}
        onRetry={() => {
          setSaved(undefined);
          remote.refresh();
          projects.refresh();
        }}
      />
      {!ready ? (
        <Empty loading={remote.loading || projects.loading} />
      ) : (
        <>
          <button
            type="button"
            className={secondaryClass}
            disabled={busy || !projects.data?.projects.length}
            onClick={() =>
              void change(
                projects.data!.projects.map((p) => p.id),
                true,
              )
            }
          >
            모든 현장 선택
          </button>
          <div className="grid gap-2 sm:grid-cols-2">
            {projects.data?.projects.map((project) => (
              <label
                key={project.id}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 p-3"
              >
                <input
                  type="checkbox"
                  aria-label={project.name}
                  className="h-5 w-5 shrink-0"
                  disabled={busy}
                  checked={
                    pending?.ids.includes(project.id)
                      ? pending.checked
                      : current.some((a) => a.project_id === project.id)
                  }
                  onChange={(event) => void change([project.id], event.target.checked)}
                />
                <span className="min-w-0 break-words">
                  {project.name}
                  {!current.some((a) => a.project_id === project.id) &&
                    upcoming
                      .filter((a) => a.project_id === project.id)
                      .map((a) => (
                        <span key={a.id} className="block text-sm text-orange-700">
                          {a.valid_from}부터 배정 예약됨 · 체크하면 오늘부터 배정
                        </span>
                      ))}
                </span>
              </label>
            ))}
          </div>
          {!projects.data?.projects.length && <p>기준정보에서 현장을 먼저 등록하세요.</p>}
        </>
      )}
    </section>
  );
}
