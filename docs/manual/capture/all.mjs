// 순서가 시연 상태를 만든다. 실패하면 멈추고 오류를 고친 뒤 전용 DB를 초기화해 다시 시작한다.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BASE } from './lib.mjs';
for (const name of [
  'checklist',
  'driver-a',
  'driver-b',
  'driver-extra',
  'site',
  'settle',
  'admin',
  'driver-c',
]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./${name}.mjs`, import.meta.url))], {
    env: { ...process.env, BASE },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
