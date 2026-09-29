import { evidenceKinds, money, operationLabels, type UseDetail } from '@/client/types';
import { Section } from './fields';

export function ReadOnlyUse({ use }: { use: UseDetail }) {
  return (
    <>
      <Section title="운행 상세">
        <dl className="grid gap-3">
          {[
            ['사용일', use.use_date],
            ['현장', String(use.snapshot.project_name)],
            ['차량', String(use.snapshot.plate_no)],
            ['요청자', use.requester || '—'],
            ['운반 내용', use.cargo_desc || '—'],
            ['특이사항', use.notes || '—'],
            ['운행 상태', operationLabels[use.operation_status]],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-slate-500">{label}</dt>
              <dd className="break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title={`운행 목록 · ${use.trips.length}회`}>
        <ul className="space-y-3">
          {use.trips.map((trip) => (
            <li key={trip.id} className="rounded-xl bg-slate-50 p-3">
              <p className="font-semibold">
                {trip.seq}회차 · {trip.origin} → {trip.destination}
              </p>
              <p>
                {trip.cargo_desc} · {operationLabels[trip.status]}
              </p>
              {trip.via?.length ? <p>경유: {trip.via.join(', ')}</p> : null}
              {trip.quantity && (
                <p>
                  수량 {trip.quantity} {trip.quantity_unit}
                </p>
              )}
              {trip.hours && <p>시간 {trip.hours}</p>}
              {trip.notes && <p>{trip.notes}</p>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="증빙">
        {use.evidence.length ? (
          <ul className="space-y-2">
            {use.evidence.map((file) => (
              <li key={file.id}>
                {file.text_value ? (
                  <p>
                    {evidenceKinds[file.kind]} · {file.text_value}
                  </p>
                ) : (
                  <a
                    className="inline-flex min-h-11 items-center text-blue-700 underline"
                    href={`/api/evidence/${file.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {evidenceKinds[file.kind]} · {file.original_name}
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>첨부된 증빙이 없습니다.</p>
        )}
      </Section>
      <p className="text-sm text-slate-600">
        인정액{' '}
        {money(
          use.charge_lines
            .filter((line) => line.direction === 'PAYABLE')
            .reduce((sum, line) => sum + (line.approved_amount ?? 0), 0),
        )}
      </p>
    </>
  );
}
