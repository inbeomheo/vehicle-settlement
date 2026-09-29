import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialValues, newTrip, toInput } from '../../src/components/use-form/model';
import { TripFields } from '../../src/components/use-form/trips';
import { EvidenceEditor } from '../../src/components/evidence/editor';
import type { Lookups } from '../../src/client/types';

// Vitest uses the classic JSX transform for the Next.js preserved TSX sources.
beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

it('계약 조회 전 빈 수량은 명시적 null로 보내고 고정형 기본 수량은 서버가 결정한다', () => {
  const form = initialValues({
    drivers: [],
    projects: [],
    vehicles: [],
    affiliations: [],
  } as unknown as Lookups);
  const input = toInput(form, 'driver');
  expect(input.charge_lines?.[0].quantity).toBeNull();
  expect(JSON.parse(JSON.stringify(input)).charge_lines[0]).toHaveProperty('quantity', null);
});

it.each(['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'] as const)(
  '%s의 기본 청구 수량 1은 명시적으로 유지한다',
  (unit) => {
    const form = initialValues({
      drivers: [],
      projects: [],
      vehicles: [],
      affiliations: [],
    } as unknown as Lookups);
    form.charges[0].billing_unit = unit;
    expect(toInput(form, 'driver').charge_lines?.[0].quantity).toBe('1');
  },
);

it.each(['PER_DAY', 'PER_TRIP', 'PER_TON', 'PER_M3', 'PER_HOUR'] as const)(
  'W6-13 %s 운행은 상세 필드를 접고 과금에 필요한 값만 기본 표시한다',
  (unit) => {
    const markup = renderToStaticMarkup(
      createElement(TripFields, { trips: [newTrip()], recent: [], onChange: () => {}, billingUnits: [unit] }),
    );
    const detail = markup.match(/<details\b[\s\S]*?<\/details>/)?.[0];
    expect(detail).toBeTruthy();
    expect(detail).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
    expect(detail).toContain('1회차 경유 (쉼표 구분)');
    const primary = markup.replace(detail!, '');
    expect(primary).toContain('1회차 출발');
    expect(primary).toContain('1회차 도착');
    expect(primary).toContain('1회차 화물');
    expect(primary).toContain('1회차 운행 상태');
    expect(primary.includes('1회차 수량')).toBe(unit === 'PER_TON' || unit === 'PER_M3');
    expect(primary.includes('1회차 시간')).toBe(unit === 'PER_HOUR');
  },
);

it('W6-13 기본 증빙 화면은 사유 입력을 숨기고 잠긴 실패 첨부에도 취소 동작을 제공한다', () => {
  const markup = renderToStaticMarkup(
    createElement(EvidenceEditor, {
      pending: [
        {
          client_upload_id: 'failed-1',
          serverId: 'evidence-1',
          kind: 'PHOTO',
          status: 'failed',
          progress: 0,
        },
      ],
      existing: [],
      onChange: () => {},
      onDelete: async () => {},
      onRetry: () => {},
      onProcessingChange: () => {},
      locked: true,
      canRemovePending: true,
      canRetry: false,
    }),
  );
  expect(markup).not.toContain('교체·삭제 사유');
  expect(markup).toContain('첨부 취소');
  expect(markup).not.toContain('사진 다시 보내기');
});
