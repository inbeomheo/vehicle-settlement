export const networkErrorMessage = '네트워크 연결을 확인하고 다시 시도하세요.';
export const responseErrorMessage = '서버 응답을 확인하지 못했습니다. 다시 시도하세요.';

// Keep API business errors intact; browser/network and invalid JSON errors are localized here.
export async function requestJson(url: string, options?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new Error(networkErrorMessage);
  }
  const body = await response.json().catch(() => {
    throw new Error(responseErrorMessage);
  });
  if (!body || typeof body !== 'object' || !(response.ok ? 'data' in body : 'error' in body)) {
    throw new Error(responseErrorMessage);
  }
  return { response, body };
}
