import { execFileSync } from 'node:child_process';
export default function setup() { if (!process.env.TEST_DATABASE_URL) execFileSync(process.execPath, ['--import', 'tsx', 'scripts/db-start.ts'], { stdio: 'inherit' }); }
