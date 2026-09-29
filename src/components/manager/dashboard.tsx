'use client';
import Link from 'next/link';
import { Empty, Heading, Notice, money, panelClass, useRemote, secondaryClass } from './common';
export function Dashboard() {
  const { data, error, loading, refresh } = useRemote<Record<string, number>>('/api/dashboard');
  const cards = [
    ['검수 대기', 'review_pending', '/m/review?tab=SUBMITTED', false],
    ['보완 대기', 'fix_pending', '/m/review?tab=NEEDS_FIX', false],
    ['증빙 누락', 'evidence_missing', '/m/review?tab=MISSING', false],
    ['미정산 승인액', 'unsettled_approved_amount', '/m/ledger?unsettled_approved=true', true],
    ['미지급액', 'unpaid_amount', '/m/payments?status=UNPAID', true],
  ] as const;
  return (
    <>
      <Heading title="운영 대시보드" description="배정 현장의 검수와 정산 현황을 확인하세요.">
        <Link href="/m/uses/new" className={secondaryClass}>
          대리 입력
        </Link>
      </Heading>
      <Notice error={error} />
      {error && (
        <button className={secondaryClass} onClick={refresh}>
          다시 불러오기
        </button>
      )}
      {loading && !data ? (
        <Empty loading />
      ) : (
        data && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(([title, key, href, isMoney]) => (
              <Link
                key={key}
                href={href}
                className={`${panelClass} group flex min-h-40 flex-col justify-between hover:border-blue-400`}
              >
                <span className="text-sm font-medium text-slate-600">{title}</span>
                <strong className="my-3 text-3xl tracking-tight">
                  {isMoney ? money(data[key]) : `${data[key]}건`}
                </strong>
                <span className="text-xs text-slate-500">
                  {key === 'unpaid_amount'
                    ? `확정·미지급 명세 ${data.unpaid_count}건 · 부가세 포함`
                    : key === 'unsettled_approved_amount'
                      ? '승인·미잠금 지급 공급가'
                      : '목록 보기'}{' '}
                  <span aria-hidden>↗</span>
                </span>
              </Link>
            ))}
          </div>
        )
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/m/review" className={panelClass}>
          <h2 className="font-bold">검수를 이어서 진행하세요</h2>
          <p className="mt-2 text-sm text-slate-600">실적과 증빙을 확인하고 비용별 승인액을 결정합니다.</p>
        </Link>
        <Link href="/m/ledger" className={panelClass}>
          <h2 className="font-bold">차량 사용대장</h2>
          <p className="mt-2 text-sm text-slate-600">
            현장·기사·기간으로 조회하고 검색 결과 전체를 엑셀로 내보냅니다.
          </p>
        </Link>
      </div>
    </>
  );
}
