import { loadEnvConfig } from '@next/env';
import { defineConfig, devices } from '@playwright/test';

loadEnvConfig(process.cwd());

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
const port = new URL(baseURL).port || '3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  // Two in CI: one worker was on course for 30+ minutes on the merge-blocking
  // pair, against about five for two. The specs are written for parallel
  // projects (TESTING.md: per-run identifiers and throwaway riders), so a
  // second worker costs no isolation.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer:
    process.env.PW_SKIP_WEBSERVER === '1'
      ? undefined
      : {
          // CI serves the production build the job has just made. `next dev`
          // compiles each route on first request, and with every spec landing
          // on cold routes the suite fails on timeouts that have nothing to do
          // with what it tests (97 failures against `next dev`, 13 against
          // `next start`, same commit and database, 2026-08-26).
          command: process.env.CI
            ? `npm run start -- --hostname 127.0.0.1 --port ${port}`
            : `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
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
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'desktop-safari',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'desktop-edge',
      use: { ...devices['Desktop Edge'] },
    },
    {
      name: 'iphone-safari',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'android-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'ipad-safari',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
});
