'use client';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { Plate } from '@/components/ui/plate';
import { primary, button } from './fields';

export type SubmitSummary = {
  reviewer: string;
  load: string;
  date: string;
  project: string;
  plate: string;
  route: string;
  evidenceCount: number;
  amount: number | null;
};

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
function dateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '날짜 없음';
  const day = weekdays[new Date(`${value}T12:00:00Z`).getUTCDay()];
  return `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일 (${day})`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-200 py-3 last:border-b-0">
      <dt className="text-base font-semibold text-slate-700">{label}</dt>
      <dd className="min-w-0 text-right text-lg font-bold break-words text-ink">{children}</dd>
    </div>
  );
}

/**
 * 제출 직전 확인. 휴대폰에서는 아래에서 올라오는 시트, 넓은 화면에서는 가운데 창.
 * 네이티브 <dialog> 라 배경은 조작할 수 없고 Esc 로 닫히며, 닫으면 누른 버튼으로 초점이 돌아간다.
 */
export function ConfirmSubmitSheet({
  summary,
  busy,
  onConfirm,
  onClose,
  returnFocus,
}: {
  summary: SubmitSummary;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** 닫은 뒤 초점을 돌려줄 버튼. 검사 중 잠깐 비활성화되어 activeElement 로는 알 수 없다. */
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = returnFocus;
    element.showModal();
    confirmRef.current?.focus();
    return () => {
      element.close();
      const trigger = target?.current ?? active;
      // 부모가 다시 그려져 버튼이 활성화된 뒤에 초점을 돌려준다.
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, [returnFocus]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-x-0 bottom-0 mx-auto mt-auto mb-0 max-h-[92dvh] w-full max-w-lg overflow-auto rounded-t-2xl bg-white px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink shadow-xl backdrop:bg-slate-950/60 sm:top-0 sm:mb-auto sm:rounded-2xl"
    >
      <h2 id={titleId} className="text-[1.5rem] font-bold">
        이대로 보낼까요?
      </h2>
      <p className="mt-1 text-base text-slate-700">보내면 담당자가 확인합니다.</p>
      <dl className="mt-4 rounded-xl bg-slate-50 px-4">
        <Row label="날짜">{dateLabel(summary.date)}</Row>
        <Row label="현장">{summary.project || '현장 없음'}</Row>
        <Row label="담당자">{summary.reviewer}</Row>
        <Row label="적재용량">{summary.load ? `${summary.load}톤` : '미입력'}</Row>
        <Row label="차량">
          <Plate value={summary.plate} size="md" />
        </Row>
        <Row label="경로">{summary.route || '경로 없음'}</Row>
        <Row label="사진·증빙">{summary.evidenceCount}건</Row>
        <Row label="예상 금액">
          {summary.amount === null ? (
            <span className="text-base text-slate-700">금액 미정(담당자가 정함)</span>
          ) : (
            <span className="num">{summary.amount.toLocaleString('ko-KR')}원</span>
          )}
        </Row>
      </dl>
      <div className="mt-5 grid gap-2.5">
        <button
          ref={confirmRef}
          type="button"
          className={`${primary} min-h-16 w-full text-xl`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? '보내는 중…' : '보내기'}
        </button>
        <button
          type="button"
          className={`${button} min-h-14 w-full text-lg`}
          disabled={busy}
          onClick={onClose}
        >
          고치기
        </button>
      </div>
    </dialog>
  );
}
