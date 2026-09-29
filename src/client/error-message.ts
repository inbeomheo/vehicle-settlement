/** Keep browser, storage and gateway diagnostics out of user-facing messages. */
export function errorMessage(error: unknown, fallback = '처리하지 못했습니다. 다시 시도해 주세요.') {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/fetch|network|load failed|timeout|timed out|connection|abort/i.test(message))
    return '인터넷 연결을 확인하고 다시 시도해 주세요. 입력한 내용은 화면에 유지됩니다.';
  if (
    error instanceof Error &&
    ['QuotaExceededError', 'UnknownError', 'InvalidStateError'].includes(error.name)
  )
    return '휴대폰에 저장하지 못했습니다. 저장 공간을 확인하고 다시 시도해 주세요.';
  return /[가-힣]/.test(message) ? message : fallback;
}
