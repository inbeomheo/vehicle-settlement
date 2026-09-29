import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
export default function setup() {
  const storage = mkdtempSync(path.join(os.tmpdir(), 'vehicle-vitest-storage-'));
  process.env.STORAGE_DIR = storage;
  if (!process.env.TEST_DATABASE_URL)
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/db-start.ts'], { stdio: 'inherit' });
  return () => rmSync(storage, { recursive: true, force: true });
}
