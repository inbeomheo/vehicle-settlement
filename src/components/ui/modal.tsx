'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const elements = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, iframe, [tabindex]',
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0,
        );
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      aria-labelledby={titleId}
      aria-busy={busy}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-auto rounded-xl bg-white p-4 text-slate-900 shadow-xl backdrop:bg-slate-950/70 sm:p-6"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id={titleId} className="mb-4 break-words text-lg font-bold">
        {title}
      </h2>
      {children}
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className="space-y-3 text-sm">{children}</div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={onClose}
          className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-50"
        >
          돌아가기
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label={confirmLabel}
          onClick={onConfirm}
          className="min-h-11 rounded-lg bg-slate-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? '처리 중…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
