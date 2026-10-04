/** 업무 날짜는 브라우저·서버 시간대와 무관하게 서울 기준이다. */
export function seoulDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export type ClosingPeriodSettings = { today: string; closing_start_day: number };
export type ClosingPeriod = { from: string; to: string };

/** offset=-1은 지난 마감. 1일 시작은 해당 달의 첫날부터 말일까지다. */
export function closingPeriod(today: string, startDay: number, offset = 0): ClosingPeriod {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
    throw new RangeError('마감 시작일은 1일부터 28일까지입니다.');
  }
  const [year, month, day] = today.split('-').map(Number);
  const startMonth = month - 1 + (day < startDay ? -1 : 0) + offset;
  return {
    from: new Date(Date.UTC(year, startMonth, startDay)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, startMonth + 1, startDay - 1)).toISOString().slice(0, 10),
  };
}
export function closingPeriodLabel(today: string, startDay: number, offset = 0) {
  const { from, to } = closingPeriod(today, startDay, offset);
  const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const label =
    startDay === 1 ? (offset === 0 ? '이번 달' : '지난달') : offset === 0 ? '이번 마감' : '지난 마감';
  return `${label} (${short(from)}~${short(to)})`;
}
