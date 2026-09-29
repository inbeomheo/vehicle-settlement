'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, mutate } from '@/client/api';
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
  summary: ImportSummary | null;
};
type Preset = { id: string; name: string; mapping: ImportMapping };
const control = 'min-h-11 w-full rounded border border-slate-300 bg-white px-3 py-2';
const button = 'min-h-11 rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50';

export default function ImportPage() {
  const [job, setJob] = useState<ImportView | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [sheet, setSheet] = useState(0);
  const [header, setHeader] = useState(1);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [presetName, setPresetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(true);
  async function refresh() {
    const [jobs, saved] = await Promise.all([
      api<History[]>('/api/import'),
      api<Preset[]>('/api/import/presets'),
    ]);
    setHistory(jobs);
    setPresets(saved);
  }
  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했습니다. 다시 시도하세요.');
    } finally {
      setBusy(false);
    }
  }
  function selectJob(value: ImportView) {
    setJob(value);
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
      const response = await fetch('/api/import/upload', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? '업로드에 실패했습니다.');
      selectJob(result.data);
      await refresh();
    });
  }
  const columns = job?.sheets[sheet]?.rows[header - 1] ?? [];
  const committed = job?.status === 'COMMITTED';
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">엑셀 가져오기</h1>
        <p className="mt-2 text-slate-600">
          파일 선택 → 시트·열 매핑 → 행 검증 → 임시저장. 가져온 자료는 담당자 대리 입력으로 저장됩니다. 증빙을
          추가하고 제출·검수하세요.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-red-800">
          {error}
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
          className="mt-3 block w-full text-sm"
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
            운행횟수와 청구수량은 별개입니다. 일대·반일·월대·1식은 수량 기본값 1, 다른 단위의 빈 수량과 빈
            단가는 미확정입니다. 같은 이름이 여러 개면 기준정보 ID를 사용하세요.
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
                    await mutate('/api/import/presets', { name: presetName, mapping });
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
                    const next = await mutate<ImportView>(`/api/import/${job.id}/preview`, {
                      sheet,
                      header_row: header,
                      mapping,
                      excluded_rows: excluded,
                    });
                    setJob(next);
                    setDirty(false);
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
              {dirty && <p className="text-amber-800">매핑이 변경되었습니다. 미리보기를 다시 검증하세요.</p>}
              <div className="flex flex-wrap items-center gap-3">
                <a className="text-blue-800 underline" href={`/api/import/${job.id}/errors.xlsx`}>
                  오류 행 엑셀 다운로드
                </a>
                <button
                  className={button}
                  disabled={busy || committed || dirty || !job.summary.valid}
                  onClick={() =>
                    void run(async () => {
                      const next = await mutate<ImportView>(`/api/import/${job.id}/commit`, {});
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
                          <input
                            type="checkbox"
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
                            <Link className="block text-blue-800 underline" href={`/m/uses/${r.use_id}`}>
                              사용 상세
                            </Link>
                          )}
                        </td>
                        <td className="max-w-60 break-words p-2">{r.values.join(' / ')}</td>
                        <td className="p-2">
                          <span className="text-red-800">{r.errors.join(' · ')}</span>
                          <span className="text-amber-800">{r.warnings.join(' · ')}</span>
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
        {!history.length && <p className="text-slate-600">아직 가져온 파일이 없습니다.</p>}
        <div className="space-y-2">
          {history.map((h) => (
            <button
              key={h.id}
              disabled={busy}
              className="block w-full rounded border bg-white p-3 text-left disabled:opacity-50"
              onClick={() => void run(async () => selectJob(await api<ImportView>(`/api/import/${h.id}`)))}
            >
              <span className="break-all font-semibold">{h.file_name}</span>
              <span className="mt-1 block text-sm text-slate-600">
                {new Date(h.created_at).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false })} ·{' '}
                {h.created_by_name} ·{' '}
                {h.status === 'COMMITTED' ? '완료' : h.status === 'FAILED' ? '실패' : '미리보기'} · 성공{' '}
                {h.summary?.success ?? 0} / 오류 {h.summary?.errors ?? 0} / 건너뜀 {h.summary?.skipped ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
