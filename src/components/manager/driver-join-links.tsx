'use client';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/modal';
import {
  Empty,
  Field,
  Notice,
  buttonClass,
  dateTime,
  inputClass,
  mutate,
  panelClass,
  secondaryClass,
  useRemote,
} from './common';
type JoinLink = {
  id: string;
  version: number;
  project_names: string[];
  used_count: number;
  expires_at: string;
  revoked_at: string | null;
};
export function DriverJoinLinks() {
  const links = useRemote<JoinLink[]>('/api/driver-join-links');
  const lookups = useRemote<{ projects: { id: string; name: string }[] }>('/api/lookups');
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<JoinLink | null>(null);
  return (
    <section className={`${panelClass} mb-6 space-y-4`} aria-label="기사 가입 링크 관리">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">기사 가입 링크</h2>
        <button className={buttonClass} onClick={() => setOpen(!open)}>
          기사 가입 링크 만들기
        </button>
      </div>
      <p className="text-sm text-slate-600">
        링크 하나를 여러 기사님께 보낼 수 있습니다. 가입한 기사는 선택한 현장에 자동 배정됩니다.
      </p>
      <Notice
        error={revoking ? undefined : error || links.error || lookups.error}
        success={success}
        onRetry={() => {
          links.refresh();
          lookups.refresh();
        }}
      />
      {open && (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const form = new FormData(event.currentTarget);
            setBusy(true);
            setError('');
            setSuccess('');
            try {
              const result = await mutate<{ join_url?: string; message?: string }>(
                '/api/driver-join-links',
                'POST',
                { project_ids: selected, expires_in_days: Number(form.get('days')) },
              );
              if (!result.join_url) throw new Error(result.message ?? '새 링크를 다시 만드세요.');
              setUrl(result.join_url);
              setOpen(false);
              links.refresh();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '링크를 만들지 못했습니다.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset>
            <legend className="mb-2 font-semibold">담당 현장 (필수, 여러 개 선택)</legend>
            <button
              type="button"
              className={`${secondaryClass} mb-3`}
              disabled={busy || !lookups.data?.projects.length}
              onClick={() => setSelected(lookups.data?.projects.map((p) => p.id) ?? [])}
            >
              모든 현장 선택
            </button>
            <div className="grid gap-2 sm:grid-cols-2">
              {lookups.data?.projects.map((project) => (
                <label
                  key={project.id}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 p-3"
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0"
                    checked={selected.includes(project.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, project.id]
                          : selected.filter((id) => id !== project.id),
                      )
                    }
                  />
                  <span className="break-words">{project.name}</span>
                </label>
              ))}
            </div>
            {lookups.loading && <p>현장을 불러오는 중…</p>}
            {lookups.data && !lookups.data.projects.length && <p>기준정보에서 현장을 먼저 등록하세요.</p>}
          </fieldset>
          <Field title="유효기간 (일)">
            <input
              name="days"
              className={`${inputClass} max-w-xs`}
              type="number"
              defaultValue="14"
              min="1"
              max="90"
              required
            />
          </Field>
          <button disabled={busy || !selected.length} className={buttonClass}>
            {busy ? '만드는 중…' : '링크 생성'}
          </button>
        </form>
      )}
      {url && (
        <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <Field title="새 기사 가입 링크">
            <input className={inputClass} readOnly value={url} onFocus={(e) => e.target.select()} />
          </Field>
          <p className="text-sm">원본 링크는 지금만 표시됩니다. 복사해서 기사님 단톡방에 보내세요.</p>
          <button
            type="button"
            className={secondaryClass}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setSuccess('링크를 복사했습니다.');
              } catch {
                setError('링크를 길게 눌러 직접 복사하세요.');
              }
            }}
          >
            복사
          </button>
        </div>
      )}
      <div className="space-y-3">
        {links.loading ? (
          <Empty loading />
        ) : links.data?.length ? (
          links.data.map((link) => {
            const expired = new Date(link.expires_at).getTime() <= Date.now();
            return (
              <article
                key={link.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="min-w-0 break-words">
                  <p className="font-semibold">{link.project_names.join(', ')}</p>
                  <p className="text-sm">
                    가입 {link.used_count}명 · {link.revoked_at ? '꺼짐' : expired ? '만료됨' : '사용 중'}
                  </p>
                  <p className="text-sm text-slate-600">만료: {dateTime(link.expires_at)}</p>
                </div>
                {!link.revoked_at && !expired && (
                  <button
                    className={secondaryClass}
                    onClick={() => {
                      setError('');
                      setRevoking(link);
                    }}
                  >
                    링크 끄기
                  </button>
                )}
              </article>
            );
          })
        ) : (
          <p className="text-slate-600">만든 가입 링크가 없습니다.</p>
        )}
      </div>
      {revoking && (
        <ConfirmDialog
          title="기사 가입 링크를 끌까요?"
          confirmLabel="링크 끄기 확인"
          busy={busy}
          error={error}
          onClose={() => {
            setRevoking(null);
            setError('');
          }}
          onConfirm={async () => {
            setBusy(true);
            setError('');
            try {
              await mutate(`/api/driver-join-links/${revoking.id}`, 'DELETE', { version: revoking.version });
              setRevoking(null);
              links.refresh();
              setSuccess('가입 링크를 껐습니다. 기존 가입 계정은 유지됩니다.');
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '처리하지 못했습니다.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>이 링크로 더 이상 가입할 수 없습니다. 이미 가입한 기사님은 계속 이용할 수 있습니다.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
