'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { getUse } from '@/server/services/uses';
import type { LedgerResult } from '@/server/services/ledger';
import { sumMoney } from '@/server/domain/money';
import { AuditPanel } from './audit';
import {
  ApiError,
  Badge,
  Empty,
  Field,
  Heading,
  Notice,
  buttonClass,
  dateTime,
  inputClass,
  label,
  money,
  mutate,
  panelClass,
  secondaryClass,
  useRemote,
} from './common';
type Detail = Awaited<ReturnType<typeof getUse>>;
type Decision = { line_review_status: 'APPROVED' | 'HELD' | 'REJECTED'; amount: string; reason: string };
export function UseDetail({ id, canSettle = false }: { id: string; canSettle?: boolean }) {
  const detail = useRemote<Detail>(`/api/uses/${id}`);
  const metadata = useRemote<LedgerResult>(`/api/ledger?use_id=${id}`);
  const [tab, setTab] = useState('detail');
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [fixes, setFixes] = useState([{ target: 'evidence', message: '' }]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ id: string; mime: string; name: string } | null>(null);
  const use = detail.data;
  useEffect(() => {
    if (!detail.data) return;
    setDecisions(
      Object.fromEntries(
        detail.data.charge_lines.map((line) => [
          line.id,
          {
            line_review_status: line.line_review_status === 'PENDING' ? 'APPROVED' : line.line_review_status,
            amount: line.approved_amount == null ? '' : String(line.approved_amount),
            reason: '',
          },
        ]),
      ),
    );
  }, [detail.data]);
  if (!use)
    return (
      <>
        <Heading title="사용 상세" />
        <Notice error={detail.error} />
        {detail.error ? (
          <button className={secondaryClass} onClick={detail.refresh}>
            다시 불러오기
          </button>
        ) : (
          <Empty loading />
        )}
      </>
    );
  const locked = use.charge_lines.some((line) => line.locked_statement_id);
  const canReview = use.review_status === 'SUBMITTED' && !locked && !busy && !conflict && !detail.loading;
  const snapshot = (key: string) => String(use.snapshot[key] ?? '—');
  const decisionBody = (lineId: string) => {
    const decision = decisions[lineId];
    const line = use.charge_lines.find((item) => item.id === lineId);
    if (!decision || !line) throw new Error('비용 정보를 다시 불러오세요.');
    const amountChanged = decision.amount !== '' && Number(decision.amount) !== line.approved_amount;
    if (
      decision.line_review_status === 'APPROVED' &&
      amountChanged &&
      (!/^\d+$/.test(decision.amount) || Number(decision.amount) > 2147483647)
    )
      throw new Error('승인 공급가는 0 이상의 정수 원으로 입력하세요.');
    return {
      id: lineId,
      line_review_status: decision.line_review_status,
      ...(decision.line_review_status === 'APPROVED' && amountChanged
        ? { approved_amount: Number(decision.amount) }
        : {}),
      ...(decision.reason ? { reason: decision.reason } : {}),
    };
  };
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
      setSuccess(message);
      detail.refresh();
      metadata.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '처리하지 못했습니다.');
      if (reason instanceof ApiError && reason.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  };
  const updateDecision = (lineId: string, patch: Partial<Decision>) =>
    setDecisions((previous) => ({ ...previous, [lineId]: { ...previous[lineId], ...patch } }));
  return (
    <>
      <Heading title={use.use_no} description={`${use.use_date} · ${snapshot('project_name')}`}>
        <div className="flex flex-wrap gap-2">
          <Link href="/m/review" className={secondaryClass}>
            검수함
          </Link>
          <Link className={secondaryClass} href={`/m/uses/${id}/edit`}>
            수정
          </Link>
        </div>
      </Heading>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Badge value={use.review_status} />
        <Badge value={use.operation_status} />
        <span className="text-xs text-slate-500">
          제출 {use.current_revision_no}차 · 버전 {use.version}
        </span>
        {locked && <span className="text-sm font-semibold text-amber-800">확정 명세에 연결되어 잠김</span>}
      </div>
      <Notice error={error || detail.error || metadata.error} success={success} />
      {conflict && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="mb-3 text-sm">
            다른 변경 또는 명세 잠금이 확인되었습니다. 최신 내용을 불러온 후 검수 내용을 다시 확인하세요.
          </p>
          <button
            className={secondaryClass}
            onClick={() => {
              setConflict(false);
              setError('');
              detail.refresh();
              metadata.refresh();
            }}
          >
            최신 내용 불러오기
          </button>
        </div>
      )}
      <div role="tablist" aria-label="사용 상세 탭" className="mb-5 flex flex-wrap gap-2">
        {[
          ['detail', '사용 정보·검수'],
          ['history', '제출·검수 이력'],
          ['audit', '변경 이력'],
        ].map(([value, title]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? buttonClass : secondaryClass}
            onClick={() => setTab(value)}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === 'audit' && <AuditPanel useId={id} />}
      {tab === 'history' && (
        <div className="grid gap-4">
          {use.revisions.map((revision) => (
            <article className={panelClass} key={revision.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="font-bold">제출 {revision.revision_no}차</h2>
                <Badge value={revision.decision} />
              </div>
              <p className="mt-3 text-sm">
                제출: {dateTime(revision.submitted_at)} ·{' '}
                {metadata.data?.rows[0]?.actor_names?.[revision.submitted_by] ?? '작성자'}
                <br />
                검수: {dateTime(revision.decided_at)} ·{' '}
                {revision.decided_by
                  ? (metadata.data?.rows[0]?.actor_names?.[revision.decided_by] ?? '담당자')
                  : '대기'}
              </p>
              {revision.comment && <p className="mt-2 text-sm">{revision.comment}</p>}
              {revision.fix_items.map((fix, index) => (
                <p key={index} className="mt-2 rounded bg-amber-50 p-2 text-sm">
                  {fix.target}: {fix.message}
                </p>
              ))}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-blue-800">제출 당시 내용</summary>
                <pre className="mt-2 max-h-96 overflow-auto bg-slate-50 p-3 text-xs whitespace-pre-wrap break-all">
                  {JSON.stringify(revision.snapshot, null, 2)}
                </pre>
              </details>
            </article>
          ))}
          {!use.revisions.length && <Empty>아직 제출하지 않은 사용 건입니다.</Empty>}
        </div>
      )}
      {tab === 'detail' && (
        <div className="grid gap-5">
          <section className={panelClass}>
            <h2 className="mb-4 text-lg font-bold">사용 정보</h2>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['현장', snapshot('project_name')],
                ['실제 기사', snapshot('driver_name')],
                ['기사 연락처', snapshot('driver_phone')],
                ['차량', `${snapshot('plate_no')} · ${snapshot('vehicle_type')} · ${snapshot('tonnage')}톤`],
                ['운송사/지급처', snapshot('payee_name')],
                ['고객', snapshot('customer_name')],
                ['공종', metadata.data?.rows[0]?.work_type_name ?? '—'],
                ['요청자', use.requester ?? '—'],
                ['작성자', metadata.data?.rows[0]?.creator_name ?? use.created_by_user_id],
                ['입력 구분', label(use.entered_as)],
                [
                  '기사 확인',
                  use.entered_as === 'PROXY'
                    ? use.driver_confirmed_at
                      ? dateTime(use.driver_confirmed_at)
                      : '기사 미확인'
                    : '본인 작성',
                ],
                ['사용 기간', `${use.use_date}${use.end_date ? ' ~ ' + use.end_date : ''}`],
                ['작업내용', use.cargo_desc ?? '—'],
                ['비고', use.notes ?? '—'],
              ].map(([title, value]) => (
                <div key={title}>
                  <dt className="text-xs text-slate-500">{title}</dt>
                  <dd className="mt-1 break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-slate-500">
              현장·기사·차량·거래처 정보는 사용 당시 저장된 내용을 표시합니다.
            </p>
          </section>
          {use.duplicate_hint && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              같은 경로의 운행이 반복되어 있습니다. 정상 반복 운행일 수 있으니 실적을 확인하세요.
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            <section className={panelClass}>
              <h2 className="mb-3 text-lg font-bold">운행 실적 ({use.trips.length}건)</h2>
              {use.trips.map((trip) => (
                <article key={trip.id} className="border-t border-slate-100 py-3">
                  <div className="flex justify-between gap-2">
                    <strong className="text-sm">
                      {trip.seq}회 · {trip.origin} → {trip.destination}
                    </strong>
                    <Badge value={trip.status} />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {trip.via?.length ? `경유 ${trip.via.join(' → ')} · ` : ''}
                    {trip.quantity ?? '—'} {trip.quantity_unit ?? ''} · {trip.hours ?? '—'}시간{' '}
                    {trip.is_empty_return ? '· 공차 복귀' : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    출발 {dateTime(trip.depart_at)} / 도착 {dateTime(trip.arrive_at)}
                  </p>
                  {trip.cargo_desc && <p className="mt-1 text-sm">{trip.cargo_desc}</p>}
                  {trip.notes && <p className="text-sm">{trip.notes}</p>}
                </article>
              ))}
              {!use.trips.length && <Empty>등록된 운행이 없습니다.</Empty>}
            </section>
            <section className={panelClass}>
              <h2 className="mb-3 text-lg font-bold">증빙 ({use.evidence.length}개)</h2>
              {metadata.data?.rows[0]?.evidence_missing && (
                <p className="mb-3 text-sm text-amber-800">필수 증빙이 누락되었습니다.</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {use.evidence.map((file) => (
                  <article className="min-w-0 rounded-lg border border-slate-200 p-3" key={file.id}>
                    <strong className="text-sm">{label(file.kind)}</strong>
                    <p className="mt-1 break-all text-xs text-slate-500">
                      {file.original_name ?? file.text_value}
                    </p>
                    <Badge value={file.upload_status} />
                    {file.original_name && file.upload_status === 'UPLOADED' && (
                      <>
                        {file.mime?.startsWith('image/') && (
                          <button
                            type="button"
                            className="mt-2 block w-full"
                            onClick={() =>
                              setPreview({ id: file.id, mime: file.mime!, name: file.original_name! })
                            }
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              className="h-28 w-full rounded object-cover"
                              src={`/api/evidence/${file.id}/file`}
                              alt={`${label(file.kind)} 썸네일`}
                            />
                          </button>
                        )}
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-blue-800">
                          <button
                            className="min-h-10 underline"
                            onClick={() =>
                              setPreview({ id: file.id, mime: file.mime ?? '', name: file.original_name! })
                            }
                          >
                            원본 보기
                          </button>
                          <a
                            className="inline-flex min-h-10 items-center underline"
                            href={`/api/evidence/${file.id}/file`}
                          >
                            다운로드
                          </a>
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
              {!use.evidence.length && <Empty>등록된 증빙이 없습니다.</Empty>}
            </section>
          </div>
          <section className={panelClass}>
            <h2 className="text-lg font-bold">비용 검수</h2>
            <p className="mt-1 text-xs text-slate-500">
              승인 공급가는 부가세를 제외한 금액입니다. 기존 승인액은 유지하며, 처음 승인할 때 비워두면 계약
              조건으로 계산합니다. 공급가를 변경하면 부가세 10%를 다시 계산합니다. 보류·반려 선택은 전체 승인
              시 유지됩니다.
            </p>
            <div className="mt-4 max-w-full overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs">
                  <tr>
                    {[
                      '구분',
                      '단위',
                      '수량',
                      '단가',
                      '계산액',
                      '요청액',
                      '승인 공급가(원)',
                      '현재 상태',
                      '검수 결정',
                      '검수 사유',
                      '처리',
                    ].map((title) => (
                      <th key={title} className="px-3 py-3 whitespace-nowrap">
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {use.charge_lines.map((line) => (
                    <tr
                      className="border-t border-slate-100"
                      key={line.id}
                      data-testid={`charge-${line.charge_type}`}
                    >
                      <td className="min-w-32 px-3 py-4">
                        <strong>{label(line.charge_type)}</strong>
                        <p className="text-xs text-slate-500">
                          {label(line.direction)} · {label(line.tax_mode)}
                        </p>
                        {line.reason && <p className="mt-1 text-xs">{line.reason}</p>}
                        {line.included_in_base && <span className="text-xs">기본운임 포함</span>}
                      </td>
                      <td className="px-3 whitespace-nowrap">{label(line.billing_unit)}</td>
                      <td className="px-3 whitespace-nowrap">{line.quantity ?? '—'}</td>
                      <td className="px-3 whitespace-nowrap">{money(line.unit_price)}</td>
                      <td className="px-3 whitespace-nowrap">{money(line.computed_amount)}</td>
                      <td className="px-3 whitespace-nowrap">{money(line.requested_amount)}</td>
                      <td className="min-w-36 px-3">
                        {use.review_status === 'SUBMITTED' ? (
                          <input
                            aria-label={`${label(line.charge_type)} 승인 공급가`}
                            type="number"
                            min="0"
                            max="2147483647"
                            step="1"
                            inputMode="numeric"
                            className={inputClass}
                            placeholder="자동 계산"
                            disabled={!canReview}
                            value={decisions[line.id]?.amount ?? ''}
                            onChange={(e) => updateDecision(line.id, { amount: e.target.value })}
                          />
                        ) : (
                          money(line.approved_amount)
                        )}
                        {line.tax_mode === 'VAT_INCLUDED' && (
                          <p className="mt-1 whitespace-nowrap text-xs text-slate-500">
                            {line.approved_amount !== null && line.tax_amount !== null
                              ? `현재 합계 ${money(sumMoney([line.approved_amount, line.tax_amount]))}`
                              : `계산 합계 ${money(line.computed_amount ?? line.requested_amount)}`}
                            {' · 부가세 포함'}
                          </p>
                        )}
                      </td>
                      <td className="px-3">
                        <Badge value={line.line_review_status} />
                        {line.price_status === 'PENDING' && (
                          <p className="mt-1 text-xs text-amber-800">단가 미확정</p>
                        )}
                      </td>
                      <td className="min-w-28 px-3">
                        <select
                          aria-label={`${label(line.charge_type)} 검수 결정`}
                          className={inputClass}
                          disabled={!canReview}
                          value={decisions[line.id]?.line_review_status ?? 'APPROVED'}
                          onChange={(e) =>
                            updateDecision(line.id, {
                              line_review_status: e.target.value as Decision['line_review_status'],
                            })
                          }
                        >
                          {['APPROVED', 'HELD', 'REJECTED'].map((value) => (
                            <option value={value} key={value}>
                              {label(value)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="min-w-40 px-3">
                        <input
                          aria-label={`${label(line.charge_type)} 검수 사유`}
                          disabled={!canReview}
                          className={inputClass}
                          value={decisions[line.id]?.reason ?? ''}
                          onChange={(e) => updateDecision(line.id, { reason: e.target.value })}
                        />
                      </td>
                      <td className="px-3">
                        <button
                          className={secondaryClass}
                          disabled={!canReview}
                          onClick={() =>
                            run(() => {
                              const { id: lineId, ...decision } = decisionBody(line.id);
                              return mutate(`/api/charge-lines/${lineId}/review`, 'PATCH', {
                                version: use.version,
                                ...decision,
                              });
                            }, '비용 검수가 저장되었습니다.')
                          }
                        >
                          적용
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {use.review_status === 'SUBMITTED' && (
              <div className="mt-5 flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                  <Field title="검수 의견">
                    <input
                      className={inputClass}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      maxLength={5000}
                    />
                  </Field>
                </div>
                <button
                  className={buttonClass}
                  disabled={!canReview}
                  onClick={() =>
                    run(
                      () =>
                        mutate(`/api/uses/${id}/approve`, 'POST', {
                          version: use.version,
                          comment,
                          lines: use.charge_lines.map((line) => decisionBody(line.id)),
                        }),
                      '검수가 완료되었습니다. 보류·반려 항목을 제외하고 승인했습니다.',
                    )
                  }
                >
                  전체 승인 (보류·반려 제외)
                </button>
              </div>
            )}
          </section>
          {use.review_status === 'SUBMITTED' && (
            <section className={panelClass}>
              <h2 className="mb-3 text-lg font-bold">보완 요청</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      mutate(`/api/uses/${id}/request-fix`, 'POST', {
                        version: use.version,
                        comment,
                        fix_items: fixes,
                      }),
                    '보완 요청을 전달했습니다.',
                  );
                }}
              >
                <div className="grid gap-3">
                  {fixes.map((fix, index) => (
                    <div className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]" key={index}>
                      <Field title={`보완 항목 ${index + 1}`}>
                        <select
                          className={inputClass}
                          value={fix.target}
                          onChange={(e) =>
                            setFixes(
                              fixes.map((item, i) =>
                                i === index ? { ...item, target: e.target.value } : item,
                              ),
                            )
                          }
                        >
                          <option value="evidence">증빙</option>
                          <option value="cargo_desc">작업내용</option>
                          <option value="requester">요청자</option>
                          {use.trips.map((trip) => (
                            <option key={trip.id} value={`trip:${trip.seq}.destination`}>
                              {trip.seq}회 하차 장소
                            </option>
                          ))}
                          {use.charge_lines.map((line) => (
                            <option key={line.id} value={`charge:${line.id}`}>
                              {label(line.charge_type)} ({label(line.direction)})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field title={`보완 메시지 ${index + 1}`}>
                        <input
                          required
                          maxLength={1000}
                          className={inputClass}
                          value={fix.message}
                          onChange={(e) =>
                            setFixes(
                              fixes.map((item, i) =>
                                i === index ? { ...item, message: e.target.value } : item,
                              ),
                            )
                          }
                          placeholder="수정할 내용을 구체적으로 입력하세요."
                        />
                      </Field>
                      <button
                        type="button"
                        className={secondaryClass}
                        disabled={fixes.length === 1}
                        onClick={() => setFixes(fixes.filter((_, i) => i !== index))}
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    className={secondaryClass}
                    disabled={fixes.length >= 100}
                    onClick={() => setFixes([...fixes, { target: 'evidence', message: '' }])}
                  >
                    항목 추가
                  </button>
                  <button className={buttonClass} disabled={!canReview}>
                    보완 요청 보내기
                  </button>
                </div>
              </form>
            </section>
          )}
          <section className={panelClass}>
            <h2 className="mb-3 text-lg font-bold">정산 연결</h2>
            {metadata.data?.rows[0]?.locked_statements.map((statement) => (
              <p className="mb-2 text-sm" key={statement.id}>
                {canSettle ? (
                  <Link
                    className="font-semibold text-blue-800 underline"
                    href={`/m/statements/${statement.id}`}
                  >
                    {statement.statement_no ?? '확정 명세'}
                  </Link>
                ) : (
                  <span className="font-semibold">{statement.statement_no ?? '확정 명세'}</span>
                )}{' '}
                · {label(statement.direction)} · {statement.period_start} ~ {statement.period_end}
              </p>
            ))}
            {!locked && <p className="text-sm text-slate-500">잠긴 정산명세가 없습니다.</p>}
          </section>
        </div>
      )}
      {preview && <EvidencePreview file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
function EvidencePreview({
  file,
  onClose,
}: {
  file: { id: string; mime: string; name: string };
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let objectUrl = '';
    let canceled = false;
    fetch(`/api/evidence/${file.id}/file`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('증빙을 열 수 없습니다. 권한과 파일 상태를 확인하세요.');
        return response.blob();
      })
      .then((blob) => {
        if (canceled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((reason: Error) => {
        if (!canceled) setError(reason.message);
      });
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id]);
  return (
    <div
      className="fixed inset-0 z-50 overflow-auto bg-slate-950/70 p-3 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="증빙 원본"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="mx-auto max-w-5xl rounded-xl bg-white p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="break-all font-bold">{file.name}</h2>
          <button autoFocus className={secondaryClass} onClick={onClose}>
            닫기
          </button>
        </div>
        <Notice error={error} />
        {url ? (
          file.mime.startsWith('image/') ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={url} alt={file.name} className="mx-auto max-w-full" />
          ) : (
            <iframe title={file.name} src={url} className="h-[75vh] w-full" />
          )
        ) : (
          !error && <Empty loading />
        )}
      </div>
    </div>
  );
}
