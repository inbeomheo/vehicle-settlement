export function NoProjectNotice() {
  return (
    <p
      role="status"
      className="rounded-lg border border-orange-200 bg-orange-50 p-4 leading-relaxed text-orange-800"
    >
      아직 배정된 현장이 없어요. 관리자에게 &apos;기사관리&apos;에서 현장을 배정해 달라고 하세요.
    </p>
  );
}
