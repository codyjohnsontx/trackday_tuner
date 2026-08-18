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
      'next-env.d.ts',
      'eslint.config.mjs',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default eslintConfig;
