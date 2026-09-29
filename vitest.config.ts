import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ resolve: { alias: { '@': path.resolve('src') } }, test: { include: ['tests/{unit,integration}/**/*.test.ts'], globalSetup: ['tests/helpers/global-setup.ts'], testTimeout: 30000, hookTimeout: 60000, maxWorkers: 4 } });
