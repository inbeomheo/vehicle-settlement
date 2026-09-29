/** 차량번호를 실제 번호판처럼 표시한다. 앱 전체의 대표 요소. */
export function Plate({
  value,
  size = 'md',
}: {
  value: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!value) return <span className="text-slate-500">차량 미지정</span>;
  const text = size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-xs' : 'text-sm';
  return <span className={`plate ${text}`}>{value}</span>;
}
