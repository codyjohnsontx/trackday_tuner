import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Next 15 wrote `jsx: preserve` into tsconfig, which left esbuild on the
  // classic runtime and made any imported .tsx fail with `React is not defined`;
  // Next 16 writes `react-jsx`, and this keeps the suite independent of which.
  // Tests are still node-environment and .ts only, but a suite can import a
  // component and render it with react-dom/server.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` is a webpack alias Next resolves at build time, not an
      // installed package, so a suite that imports a real server module -
      // `lib/rag/advice.ts`, say - cannot load without a stand-in. The eval
      // harness needs the same thing and its loader points at the same stub.
      'server-only': path.resolve(__dirname, 'scripts/eval/server-only-stub.mjs'),
    },
  },
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts', 'lib/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
    },
  },
});
