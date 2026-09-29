'use client';
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  type ReactElement,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { defaultFieldModes, fieldKeyForTarget, type FieldModes } from '@/shared/form-settings';
import { hasFieldValue } from './visibility';
import type { FormError } from './model';
export { hasFieldValue } from './visibility';
export const SettingsContext = createContext<FieldModes>(defaultFieldModes('manager'));
export const RevealedFieldsContext = createContext<ReadonlySet<string>>(new Set());
export const control =
  'min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base disabled:bg-slate-100';
const buttonBase =
  'inline-flex min-h-12 items-center justify-center rounded-xl border px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50';
export const button = `${buttonBase} border-slate-300 bg-white`;
export const primary = `${buttonBase} border-blue-700 bg-blue-700 text-white`;
export const FixContext = createContext<{ target: string; message: string }[]>([]);
export const ValidationContext = createContext<FormError[]>([]);
const GroupFeedbackContext = createContext<readonly string[]>([]);
export function FormContexts({
  fixes,
  modes,
  revealed,
  errors = [],
  children,
}: {
  fixes: { target: string; message: string }[];
  modes: FieldModes;
  revealed?: ReadonlySet<string>;
  errors?: FormError[];
  children: ReactNode;
}) {
  return (
    <SettingsContext.Provider value={modes}>
      <FixContext.Provider value={fixes}>
        <RevealedFieldsContext.Provider value={revealed ?? new Set()}>
          <ValidationContext.Provider value={errors}>{children}</ValidationContext.Provider>
        </RevealedFieldsContext.Provider>
      </FixContext.Provider>
    </SettingsContext.Provider>
  );
}

export function HiddenFieldNotice() {
  return <p className="mt-2 text-sm text-slate-600">관리자 설정상 숨김 항목입니다</p>;
}
export function Field({
  label,
  target,
  children,
  hasValue,
  revealTarget = target,
}: {
  label: string;
  target?: string;
  children?: ReactNode;
  hasValue?: boolean;
  revealTarget?: string;
}) {
  const inputId = useId();
  const groupFeedback = useContext(GroupFeedbackContext);
  const errors = useContext(ValidationContext).filter(
    (error) => error.target.replace(/^use\./, '') === target,
  );
  const errorId = `${inputId}-error`;
  const fixes = useContext(FixContext).filter(
    (f) => target && (f.target === target || f.target === `use.${target}`),
  );
  const key = fieldKeyForTarget(target);
  const modes = useContext(SettingsContext);
  const revealed = useContext(RevealedFieldsContext);
  const hidden = !!key && modes[key] === 'HIDDEN';
  const input = isValidElement<{ value?: unknown; checked?: boolean }>(children) ? children : undefined;
  if (
    hidden &&
    !errors.length &&
    !fixes.length &&
    !(revealTarget && revealed.has(revealTarget)) &&
    !(hasValue ?? hasFieldValue(input?.props.value ?? input?.props.checked))
  )
    return null;
  const required = !!key && modes[key] === 'REQUIRED';
  const feedback = [
    ...groupFeedback,
    errors.length ? errorId : '',
    ...fixes.map((_, index) => `${inputId}-fix-${index}`),
  ].filter(Boolean);
  return (
    <div data-fix-target={target} className="min-w-0 scroll-mt-8">
      <label htmlFor={inputId} className="mb-2 block text-sm font-semibold text-slate-700">
        {required ? label.replace(' (선택)', '') : label}
        {required && <span className="ml-2 text-red-700">필수</span>}
      </label>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{
              id?: string;
              'aria-required'?: boolean;
              'aria-invalid'?: boolean;
              'aria-describedby'?: string;
              style?: CSSProperties;
            }>,
            {
              id: inputId,
              ...(required ? { 'aria-required': true } : {}),
              ...(feedback.length
                ? {
                    'aria-invalid': true,
                    'aria-describedby': [
                      (children as ReactElement<{ 'aria-describedby'?: string }>).props['aria-describedby'],
                      ...feedback,
                    ]
                      .filter(Boolean)
                      .join(' '),
                  }
                : {}),
              ...(errors.length
                ? {
                    style: {
                      ...(children as ReactElement<{ style?: CSSProperties }>).props.style,
                      borderColor: '#b91c1c',
                      outlineColor: '#b91c1c',
                    },
                  }
                : {}),
            },
          )
        : children}
      {errors.length > 0 && (
        <p id={errorId} className="mt-2 font-semibold text-red-700">
          {errors.map((error) => error.reason).join(' ')}
        </p>
      )}
      {hidden && <HiddenFieldNotice />}
      {fixes.map((f, i) => (
        <p
          key={i}
          id={`${inputId}-fix-${i}`}
          className="mt-2 rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-900"
        >
          보완 요청: {f.message}
        </p>
      ))}
    </div>
  );
}
export function Section({
  title,
  children,
  target,
  feedbackId,
}: {
  title: string;
  children: ReactNode;
  target?: string;
  feedbackId?: string;
}) {
  const sectionId = useId();
  const parentFeedback = useContext(GroupFeedbackContext);
  const descriptionId = feedbackId ?? `${sectionId}-feedback`;
  const errors = useContext(ValidationContext).filter(
    (error) => error.target === target && target !== 'evidence',
  );
  const fixes = useContext(FixContext).filter(
    (f) =>
      target &&
      (f.target === target ||
        (target === 'charges' && f.target === 'extra_charges') ||
        (target.startsWith('charge:') && f.target.startsWith(`${target}.`))),
  );
  const groupFeedback =
    errors.length > 0 ||
    fixes.some((fix) => fix.target === target || (target === 'charges' && fix.target === 'extra_charges'));
  return (
    <section
      data-fix-target={target}
      tabIndex={-1}
      aria-describedby={errors.length || fixes.length ? descriptionId : undefined}
      className={`scroll-mt-6 rounded-2xl border bg-white p-4 shadow-sm sm:p-6 ${errors.length ? 'border-red-700' : 'border-slate-200'}`}
    >
      <h2 className="mb-5 text-lg font-bold">{title}</h2>
      <div id={descriptionId}>
        {errors.map((error, index) => (
          <p key={index} className="mb-4 font-semibold text-red-700">
            {error.reason}
          </p>
        ))}
        {fixes.map((f, i) => (
          <p key={i} className="mb-4 rounded-xl bg-amber-50 p-3 text-amber-900">
            보완 요청: {f.message}
          </p>
        ))}
      </div>
      <GroupFeedbackContext.Provider
        value={groupFeedback ? [...parentFeedback, descriptionId] : parentFeedback}
      >
        {children}
      </GroupFeedbackContext.Provider>
    </section>
  );
}
export function StatusBadge({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${warning ? 'bg-amber-100 text-amber-900' : 'bg-blue-50 text-blue-800'}`}
    >
      {children}
    </span>
  );
}
