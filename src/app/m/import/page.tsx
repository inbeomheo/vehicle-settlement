'use client';
import { useBusy } from '@/components/ui/use-busy';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, mutate } from '@/components/manager/common';
import { ConfirmDialog } from '@/components/ui/modal';
import {
  importFields,
  type ImportField,
  type ImportMapping,
  type ImportSummary,
  type ImportView,
} from '@/server/services/import-fields';

type History = {
  id: string;
  file_name: string;
  created_at: string;
  created_by_name: string;
  status: string;
  stale_preview: boolean;
  summary: ImportSummary | null;
};
type Preset = { id: string; name: string; mapping: ImportMapping };
const control = 'min-h-11 w-full rounded border border-slate-300 bg-white px-3 py-2 text-base';
const button = 'min-h-11 rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50';

export default function ImportPage() {
  const [deleting, setDeleting] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [job, setJob] = useState<ImportView | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [sheet, setSheet] = useState(0);
  const [header, setHeader] = useState(1);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [applyContractRate, setApplyContractRate] = useState(true);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [presetName, setPresetName] = useState('');
  const { busy, begin, end } = useBusy();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(true);
  async function refresh() {
    const [jobs, saved] = await Promise.all([
      api<History[]>('/api/import'),
      api<Preset[]>('/api/import/presets'),
    ]);
    setHistory(jobs);
    setHistoryLoaded(true);
    setPresets(saved);
  }
  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);
  async function run(work: () => Promise<void>) {
    if (!begin()) return false;
    setError('');
    setNotice('');
    try {
      await work();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했습니다. 다시 시도하세요.');
      return false;
    } finally {
      end();
    }
  }
  function selectJob(value: ImportView) {
    setJob(value);
    setApplyContractRate(value.selection ? (value.selection.apply_contract_rate ?? false) : true);
    setExcluded(value.selection?.excluded_rows ?? []);
    setSheet(value.selection?.sheet ?? 0);
    setHeader(value.selection?.header_row ?? value.sheets[0].header_row);
    setMapping(value.selection?.mapping ?? value.sheets[0].mapping);
    setDirty(!value.selection);
  }
  async function upload(file?: File) {
    if (!file) return;
    await run(async () => {
      const form = new FormData();
      form.set('file', file);
      const result = await api<ImportView>('/api/import/upload', { method: 'POST', body: form });
      selectJob(result);
      await refresh();
    });
  }
  const columns = job?.sheets[sheet]?.rows[header - 1] ?? [];
  const committed = job?.status === 'COMMITTED';
  const previews = history.filter((item) => item.status === 'PREVIEW');
  const completedHistory = history.filter((item) => item.status !== 'PREVIEW');
  const stalePreviews = previews.filter((item) => item.stale_preview);
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">엑셀 가져오기</h1>
        <p className="mt-2 text-slate-600">
          파일 선택 → 시트·열 매핑 → 행 검증 → 임시저장. 가져온 자료는 담당자 대리 입력으로 저장됩니다. 증빙을
          추가하고 제출·검수하세요.
        </p>
      </div>
      {error && !deleting && (
        <p role="alert" className="rounded bg-red-50 p-3 text-red-800">
          {error}
          {!historyLoaded && (
            <button className={button} disabled={busy} onClick={() => void run(refresh)}>
              다시 시도
            </button>
          )}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded bg-green-50 p-3 text-green-800">
          {notice}
        </p>
      )}
      {busy && <p role="status">처리 중입니다…</p>}
      <label className="block rounded border bg-white p-4 font-semibold">
        xlsx / csv 파일 (10MB·2,000행·100열 이하)
        <input
          aria-label="가져올 파일"
          type="file"
          accept=".xlsx,.csv"
          disabled={busy}
          className="mt-3 block min-h-11 w-full text-base"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {job && (
        <div className="space-y-4 rounded border bg-white p-4">
          <h2 className="break-all text-xl font-bold">{job.file_name}</h2>
          <p className="text-sm text-slate-600">
            필수: 사용일, 현장, 기사, 차량번호, 지급처, 출발지, 도착지, 과금단위. 날짜는 YYYY-MM-DD, 금액은
            정수 원입니다. 수식은 저장된 결과값을 사용하며 결과가 없는 행은 오류로 표시합니다.
          </p>
          <p className="text-sm text-slate-600">
            운행횟수와 청구수량은 별개입니다. 일대·반일·월대·1식은 수량 기본값 1이며 다른 단위의 빈 수량은
            미확정입니다. 빈 단가는 아래 옵션에 따라 계약 단가를 적용합니다. 같은 이름이 여러 개면 기준정보
            ID를 사용하세요.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              시트
              <select
                aria-label="시트"
                className={control}
                value={sheet}
                disabled={busy || committed}
                onChange={(e) => {
                  const index = Number(e.target.value);
                  setSheet(index);
                  setExcluded([]);
                  setHeader(job.sheets[index].header_row);
                  setMapping(job.sheets[index].mapping);
                  setDirty(true);
                }}
              >
                {job.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              헤더 행
              <input
                aria-label="헤더 행"
                className={control}
                type="number"
                min="1"
                max={job.sheets[sheet].rows.length}
                value={header}
                disabled={busy || committed}
                onChange={(e) => {
                  setHeader(Number(e.target.value));
                  setDirty(true);
                }}
              />
            </label>
          </div>
          <fieldset disabled={busy || committed} className="space-y-4">
            <legend className="mb-2 font-bold">열 매핑</legend>
            <label className="block">
              저장된 매핑
              <select
                aria-label="저장된 매핑"
                className={control}
                defaultValue=""
                onChange={(e) => {
                  const preset = presets.find((p) => p.id === e.target.value);
                  if (preset) {
                    setMapping(preset.mapping);
                    setDirty(true);
                  }
                }}
              >
                <option value="">선택하세요</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(importFields).map(([key, labels]) => (
                <label key={key} className="text-sm">
                  {labels[0]}
                  <select
                    aria-label={`${labels[0]} 열`}
                    className={control}
                    value={mapping[key as ImportField] ?? ''}
                    onChange={(e) => {
                      setMapping((current) => {
                        const next = { ...current };
                        if (e.target.value === '') delete next[key as ImportField];
                        else next[key as ImportField] = Number(e.target.value);
                        return next;
                      });
                      setDirty(true);
                    }}
                  >
                    <option value="">미지정</option>
                    {columns.map((c, i) => (
                      <option key={i} value={i}>
                        {i + 1}열: {c || '(빈 제목)'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded border bg-slate-50 p-3">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={applyContractRate}
                onChange={(event) => {
                  setApplyContractRate(event.target.checked);
                  setDirty(true);
                }}
              />
              <span>단가 열이 비어 있으면 계약 단가 적용</span>
            </label>
            <p className="text-sm text-slate-600">
              사용일·현장·지급처·차량·과금단위에 맞는 계약을 적용합니다. 계약이 없거나 옵션을 끄면 빈 단가는
              미확정으로 저장됩니다. 파일에 적힌 0원은 확정 단가입니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="매핑 이름"
                placeholder="매핑 이름"
                className={`${control} sm:!w-64`}
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
              <button
                className={button}
                disabled={!presetName.trim()}
                onClick={() =>
                  void run(async () => {
                    await mutate('/api/import/presets', 'POST', { name: presetName, mapping });
                    await refresh();
                    setNotice('매핑을 저장했습니다.');
                  })
                }
              >
                매핑 저장
              </button>
              <button
                className={button}
                onClick={() =>
                  void run(async () => {
                    const next = await mutate<ImportView>(`/api/import/${job.id}/preview`, 'POST', {
                      sheet,
                      header_row: header,
                      mapping,
                      excluded_rows: excluded,
                      apply_contract_rate: applyContractRate,
                    });
                    setJob(next);
                    setDirty(false);
                    await refresh();
                  })
                }
              >
                미리보기 검증
              </button>
            </div>
          </fieldset>
          {job.summary && (
            <>
              <p role="status" className="font-semibold">
                유효 {job.summary.valid}건 · 오류 {job.summary.errors}건 · 건너뜀 {job.summary.skipped}건 ·
                등록 {job.summary.success}건
              </p>
              {dirty && (
                <p className="text-amber-800">매핑·옵션이 변경되었습니다. 미리보기를 다시 검증하세요.</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <a
                  className="inline-flex min-h-11 items-center text-blue-800 underline"
                  href={`/api/import/${job.id}/errors.xlsx`}
                >
                  오류 행 엑셀 다운로드
                </a>
                <button
                  className={button}
                  disabled={busy || committed || dirty || !job.summary.valid}
                  onClick={() =>
                    void run(async () => {
                      const next = await mutate<ImportView>(`/api/import/${job.id}/commit`, 'POST', {});
                      setJob(next);
                      await refresh();
                      setNotice(
                        `${next.summary?.success ?? 0}건을 임시저장했습니다. 사용 상세에서 검토 후 제출하세요.`,
                      );
                    })
                  }
                >
                  {committed ? '가져오기 완료' : '유효 행 임시저장'}
                </button>
              </div>
              <div className="max-h-[32rem] overflow-auto">
                <table className="w-full min-w-[580px] text-left text-sm">
                  <thead>
                    <tr>
                      {['제외', '원본 행', '결과', '자료', '오류·경고'].map((h) => (
                        <th key={h} className="border-b p-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {job.preview.map((r) => (
                      <tr key={r.row} className="border-b">
                        <td className="p-2">
                          <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              className="h-5 w-5"
                              aria-label={`${r.row}행 제외`}
                              checked={excluded.includes(r.row)}
                              disabled={busy || committed}
                              onChange={(e) => {
                                setExcluded((current) =>
                                  e.target.checked ? [...current, r.row] : current.filter((n) => n !== r.row),
                                );
                                setDirty(true);
                              }}
                            />
                          </label>
                        </td>
                        <td className="p-2">{r.row}</td>
                        <td className="p-2">
                          {r.status === 'ERROR'
                            ? '오류'
                            : r.status === 'SKIPPED'
                              ? excluded.includes(r.row)
                                ? '사용자 제외'
                                : '건너뜀 (동일 내용)'
                              : r.use_id
                                ? '임시저장'
                                : '유효'}
                          {r.use_id && (
                            <Link
                              className="flex min-h-11 items-center text-blue-800 underline"
                              href={`/m/uses/${r.use_id}`}
                            >
                              사용 상세
                            </Link>
                          )}
                        </td>
                        <td className="max-w-60 break-words p-2">{r.values.join(' / ')}</td>
                        <td className="p-2">
                          {!!r.errors.length && (
                            <ul className="list-inside list-disc space-y-1 text-red-800">
                              {r.errors.map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          )}
                          {!!r.warnings.length && (
                            <ul className="list-inside list-disc space-y-1 text-amber-800">
                              {r.warnings.map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      <div>
        <h2 className="mb-3 text-xl font-bold">내 가져오기 이력 (최근 100건)</h2>
        {historyLoaded && !history.length && <p className="text-slate-600">아직 가져온 파일이 없습니다.</p>}
        <div className="space-y-2">
          {completedHistory.map((item) => (
            <HistoryItem
              key={item.id}
              item={item}
              busy={busy}
              onSelect={() =>
                void run(async () => selectJob(await api<ImportView>(`/api/import/${item.id}`)))
              }
            />
          ))}
          {!!history.length && historyLoaded && !completedHistory.length && (
            <p className="text-slate-600">아직 등록을 완료한 가져오기 내역이 없습니다.</p>
          )}
        </div>
        {!!previews.length && (
          <details className="mt-4 rounded border bg-slate-50 p-3">
            <summary className="min-h-11 cursor-pointer py-3 font-semibold">
              미리보기(미확정) {previews.length}건
            </summary>
            <p className="mb-3 text-sm text-slate-600">
              업로드·검증만 진행한 파일입니다. 유효 행 임시저장 전에는 사용대장에 등록되지 않습니다.
            </p>
            <button
              className="mb-3 min-h-11 rounded border border-slate-300 bg-white px-3 py-2 disabled:opacity-50"
              disabled={busy || !stalePreviews.length}
              onClick={() => {
                setError('');
                setDeleting(true);
              }}
            >
              오래된 미확정 미리보기 삭제 (7일 이상)
            </button>
            <div className="space-y-2">
              {previews.map((item) => (
                <HistoryItem
                  key={item.id}
                  item={item}
                  busy={busy}
                  onSelect={() =>
                    void run(async () => selectJob(await api<ImportView>(`/api/import/${item.id}`)))
                  }
                />
              ))}
            </div>
          </details>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title="오래된 미리보기 삭제 확인"
          confirmLabel="삭제"
          busy={busy}
          error={error}
          onClose={() => setDeleting(false)}
          onConfirm={() =>
            void run(async () => {
              const removed = await mutate<{ deleted: number }>('/api/import', 'DELETE', {
                ids: stalePreviews.map((item) => item.id),
              });
              if (job && stalePreviews.some((item) => item.id === job.id)) setJob(null);
              await refresh();
              setNotice(`오래된 미확정 미리보기 ${removed.deleted}건을 삭제했습니다.`);
            }).then((ok) => {
              if (ok) setDeleting(false);
            })
          }
        >
          <p>현재 목록에서 확인한 7일 이상 지난 미확정 미리보기 {stalePreviews.length}건을 삭제합니다.</p>
          <ul className="list-inside list-disc">
            {stalePreviews.map((item) => (
              <li key={item.id}>{item.file_name}</li>
            ))}
          </ul>
          <p>
            삭제한 미리보기와 매핑·검증 결과는 복구할 수 없습니다. 다시 사용하려면 원본 파일을 업로드하세요.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function HistoryItem({ item, busy, onSelect }: { item: History; busy: boolean; onSelect: () => void }) {
  return (
    <button
      disabled={busy}
      className="block min-h-11 w-full rounded border bg-white p-3 text-left disabled:opacity-50"
      onClick={onSelect}
    >
      <span className="break-all font-semibold">{item.file_name}</span>
      <span className="mt-1 block text-sm text-slate-600">
        {new Date(item.created_at).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false })} ·{' '}
        {item.created_by_name} ·{' '}
        {item.status === 'PREVIEW' ? '미리보기(미확정)' : item.status === 'COMMITTED' ? '완료' : '실패'}
        {item.status !== 'PREVIEW' &&
          ` · 성공 ${item.summary?.success ?? 0} / 오류 ${item.summary?.errors ?? 0} / 건너뜀 ${item.summary?.skipped ?? 0}`}
      </span>
    </button>
  );
}
