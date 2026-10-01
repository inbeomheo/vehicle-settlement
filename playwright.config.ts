import 'dotenv/config';
import webPush from 'web-push';
import { defineConfig, devices } from '@playwright/test';

// Disposable VAPID keys for browser subscription API tests; never use production keys.
const pushKeys = webPush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = pushKeys.publicKey;
process.env.VAPID_PRIVATE_KEY = pushKeys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:e2e@example.com';

// 워크트리마다 다른 포트를 쓰도록 .env 의 PORT 를 따른다 (기본 3000).
const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${port}`;
const developmentURL =
  process.env.E2E_DEVELOPMENT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  `postgresql://postgres:postgres@127.0.0.1:${process.env.PG_PORT ?? 54329}/vehicle_app`;
const e2eURL = new URL(developmentURL);
e2eURL.pathname = '/vehicle_e2e';
process.env.E2E_DEVELOPMENT_DATABASE_URL = developmentURL;
process.env.DATABASE_URL = e2eURL.toString();
process.env.STORAGE_DIR = '.data/e2e-storage';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: e2eURL.toString(),
      STORAGE_DIR: '.data/e2e-storage',
      APP_URL: baseURL,
      PORT: String(port),
    },
    timeout: 180_000,
  },
});
