// eslint-config-next 16 ships flat configs, so they are spread in directly;
// the FlatCompat bridge this once went through fails on them ("Converting
// circular structure to JSON" from the legacy config validator).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

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
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // eslint-config-next 16 brings eslint-plugin-react-hooks 7, whose two new
    // rules read a pattern this project uses on purpose as a defect: a value
    // only the rider's device knows - today's date, the time zone, a
    // localStorage preference - is read after mount and set into state, so a
    // server render can never seed it (`useRiderClock`, `todayLocalDate`,
    // `useTemperatureUnit`; CLAUDE.md, "What a Rider Told You"). To the rule
    // that is a synchronous setState in an effect, eighteen times over, and
    // session-form.tsx has one render-time call the purity rule flags. Moving
    // those onto lazy initialisers or `useSyncExternalStore` is its own
    // change, so until it is made the two rules are off here rather than
    // disabled line by line where the next reader would take the comment for
    // an oversight.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
];

export default eslintConfig;
