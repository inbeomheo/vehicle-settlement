import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

function loadCapture(base?: string) {
  const env = { ...process.env };
  delete env.BASE;
  if (base !== undefined) env.BASE = base;
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const { BASE } = await import('./docs/manual/capture/lib.mjs'); console.log(BASE)",
    ],
    { env, encoding: 'utf8' },
  );
}

it('설명서 캡처 기본 주소는 이 워크트리의 로컬 3183다', () => {
  expect(loadCapture().stdout.trim()).toBe('http://localhost:3183');
});
it.each([
  'https://vehicle-settlement.vercel.app',
  'https://vehicle-settlement.vercel.app/manual',
  'https://example.com',
  'http://localhost:3000',
  'http://localhost:3183@vehicle-settlement.vercel.app',
  'not-a-url',
])('브라우저 실행 전에 안전하지 않은 BASE를 거부한다: %s', (base) => {
  const result = loadCapture(base);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('설명서 도구는 http://localhost:3183');
});
