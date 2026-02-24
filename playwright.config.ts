import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
const port = new URL(baseURL).port || '3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer:
    process.env.PW_SKIP_WEBSERVER === '1'
      ? undefined
      : {
          command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
          env: {
            ...process.env,
            NEXT_PUBLIC_AUTH_GOOGLE_ENABLED:
              process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED ?? 'true',
            NEXT_PUBLIC_AUTH_APPLE_ENABLED:
              process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED ?? 'false',
          },
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
