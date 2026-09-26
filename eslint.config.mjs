import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'test-results/**',
      'coverage/**',
      // Written by `supabase start`, which the migration notes in CLAUDE.md tell
      // you to run. It is a bundled Deno runtime entrypoint, git-ignored via
      // supabase/.gitignore but not by eslint, so linting after starting the
      // stack reported 154 errors in vendored minified code and none in ours.
      'supabase/.temp/**',
      // The Expo app has its own package.json, tsconfig and lint, and the Next
      // rules here would misread React Native. The fixture apps import through
      // an `@/lib` that only resolves against their own fixture root. See
      // tests/unit/mobile-shared-imports.test.ts.
      'mobile/**',
      'tests/fixtures/mobile-shared-imports/*/mobile/**',
      'next-env.d.ts',
      'eslint.config.mjs',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default eslintConfig;
