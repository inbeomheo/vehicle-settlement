export function RestrictedEvidenceNotice({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <p className="text-sm text-slate-600">
      증빙 {count}건은 담당자만 볼 수 있습니다. 사용 건의 제출·정산 근거로 보관됩니다.
    </p>
  );
}
