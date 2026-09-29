import { expect, it } from 'vitest';
import config from '../../next.config';
it('모든 응답에 보안 헤더를 설정하고 같은 출처의 기사 촬영 허용', async () => {
  const rules = await config.headers?.();
  const headers = Object.fromEntries(
    (rules?.find((r) => r.source === '/:path*')?.headers ?? []).map((h) => [h.key, h.value]),
  );
  expect(headers).toMatchObject({
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  expect(headers['Permissions-Policy']).toContain('camera=(self)');
});
