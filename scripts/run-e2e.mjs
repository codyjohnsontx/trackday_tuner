import { spawnSync } from 'node:child_process';

const isCI = process.env.CI === 'true' || process.env.CI === '1';
const forceRun = process.env.RUN_E2E === '1' || process.env.RUN_E2E === 'true';
const skipAll = process.env.SKIP_E2E === '1' || process.env.SKIP_E2E === 'true';

if (skipAll) {
  console.log('[test:e2e] Skipped because SKIP_E2E is set.');
  process.exit(0);
}

if (isCI && !forceRun) {
  console.log('[test:e2e] Skipped in CI by default. Set RUN_E2E=1 to enable.');
  process.exit(0);
}

const result = spawnSync('npx', ['playwright', 'test'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
