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
  'min-h-12 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-blue-700 focus:outline-none focus:ring-3 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500';
const buttonBase =
  'inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border px-4 py-2 font-semibold active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50';
export const button = `${buttonBase} border-slate-300 bg-white text-ink hover:bg-slate-50`;
export const primary = `${buttonBase} border-signal-strong bg-signal font-bold text-ink shadow-[0_2px_0_#c99500] hover:bg-signal-strong active:shadow-none`;
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
  hiddenPrefix,
  group = false,
  labelClassName,
}: {
  label: string;
  target?: string;
  children?: ReactNode;
  hasValue?: boolean;
  revealTarget?: string;
  /** 화면에는 숨기고 보조기기에만 읽히는 라벨 앞부분 (예: "1회차 ") */
  hiddenPrefix?: string;
  /** 선택 칩처럼 여러 입력을 묶는 그룹이면 label 대신 aria-labelledby 로 연결한다. */
  group?: boolean;
  labelClassName?: string;
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
  const labelId = `${inputId}-label`;
  const labelContent = (
    <>
      {hiddenPrefix && <span className="sr-only">{hiddenPrefix}</span>}
      {required ? label.replace(' (선택)', '') : label}
      {required && <span className="ml-2 text-sm font-bold text-red-700">필수</span>}
    </>
  );
  const labelClass = labelClassName ?? 'mb-1.5 block text-[15px] font-semibold text-ink';
  return (
    <div data-fix-target={target} className="min-w-0 scroll-mt-24">
      {group ? (
        <span id={labelId} className={labelClass}>
          {labelContent}
        </span>
      ) : (
        <label htmlFor={inputId} className={labelClass}>
          {labelContent}
        </label>
      )}
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{
              id?: string;
              'aria-labelledby'?: string;
              'aria-required'?: boolean;
              'aria-invalid'?: boolean;
              'aria-describedby'?: string;
              style?: CSSProperties;
            }>,
            {
              id: inputId,
              ...(group ? { 'aria-labelledby': labelId } : {}),
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
        <p id={errorId} className="mt-1.5 text-[15px] font-semibold text-red-700">
          {errors.map((error) => error.reason).join(' ')}
        </p>
      )}
      {hidden && <HiddenFieldNotice />}
      {fixes.map((f, i) => (
        <p
          key={i}
          id={`${inputId}-fix-${i}`}
          className="mt-1.5 rounded-md border-l-4 border-orange-500 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-900"
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
  plain = false,
  action,
  hideTitle = false,
}: {
  title: string;
  children: ReactNode;
  target?: string;
  feedbackId?: string;
  /** 카드 안에 들어가는 하위 묶음: 테두리 없이 제목만 작게 */
  plain?: boolean;
  /** 제목 오른쪽에 붙는 보조 요소 */
  action?: ReactNode;
  /** 제목을 화면에서 숨기고 보조기기에만 읽힌다 */
  hideTitle?: boolean;
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
      className={
        plain
          ? `scroll-mt-24 ${errors.length ? 'rounded-lg outline-2 outline-offset-4 outline-red-700' : ''}`
          : `scroll-mt-24 rounded-lg border bg-white p-4 sm:p-5 ${errors.length ? 'border-red-700' : 'border-slate-200'}`
      }
    >
      <div
        className={
          hideTitle ? 'sr-only' : `flex items-center justify-between gap-3 ${plain ? 'mb-3' : 'mb-4'}`
        }
      >
        <h2 className={plain ? 'text-[15px] font-bold text-slate-700' : 'text-[17px] font-bold'}>{title}</h2>
        {action}
      </div>
      <div id={descriptionId}>
        {errors.map((error, index) => (
          <p key={index} className="mb-3 font-semibold text-red-700">
            {error.reason}
          </p>
        ))}
        {fixes.map((f, i) => (
          <p
            key={i}
            className="mb-3 rounded-md border-l-4 border-orange-500 bg-orange-50 px-3 py-2 font-semibold text-orange-900"
          >
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
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold before:h-1.5 before:w-1.5 before:rounded-full ${warning ? 'border-orange-200 bg-orange-50 text-orange-800 before:bg-orange-600' : 'border-slate-200 bg-slate-50 text-slate-700 before:bg-blue-700'}`}
    >
      {children}
    </span>
  );
}

type Choice = { value: string; label: ReactNode; name: string };
/**
 * 한 번 눌러 고르는 선택 칩. 네이티브 radio 를 칩 전체에 투명하게 덮어
 * 장갑 낀 손가락으로도 누르기 쉽고, 보조기기에는 radio 그룹으로 읽힌다.
 */
export function ChoiceChips({
  name,
  value,
  choices,
  onChange,
  id,
  columns = 2,
  ...aria
}: {
  name: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  id?: string;
  columns?: 1 | 2;
  'aria-labelledby'?: string;
  'aria-required'?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  return (
    <div id={id} role="radiogroup" {...aria} className={`grid gap-2 ${columns === 2 ? 'grid-cols-2' : ''}`}>
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <label
            key={choice.value}
            className={`relative flex min-h-14 min-w-0 items-center justify-between gap-1.5 rounded-lg border-2 bg-white px-2.5 py-2 font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700 ${selected ? 'border-blue-700 bg-blue-50 text-blue-900' : 'border-slate-200 text-ink'}`}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={selected}
              aria-label={choice.name}
              onChange={() => onChange(choice.value)}
              className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none text-base opacity-0"
            />
            <span className="min-w-0 overflow-hidden">{choice.label}</span>
            {selected && (
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                className="shrink-0 rounded-full bg-blue-700 p-1 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 12 5 5 9-10" />
              </svg>
            )}
          </label>
        );
      })}
    </div>
  );
}
