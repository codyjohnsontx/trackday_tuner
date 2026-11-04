---
name: trackday-testing
description: "Use when adding, changing, or interpreting trackday_tuner unit, database, or end-to-end tests and CI coverage."
---

## What the Test Suites Cover

`vitest.config.ts` collects `app/**`, `lib/**` and `tests/unit/**` only, and the
project has no React testing library and no DOM, so **nothing in the unit suite is
interactive**. A suite can still `renderToStaticMarkup` a component and read the
attributes back - `vitest.config.ts` sets `esbuild.jsx: 'automatic'` so an imported
`.tsx` compiles whatever `jsx` Next writes into tsconfig (`preserve` until Next
15, which failed one with `React is not defined`; `react-jsx` since 16). That
reaches structural facts about one render
(`tests/unit/input-label-association.test.ts`, `tests/unit/sag-percentage-basis.test.ts`)
and nothing that needs a click, a state change or a layout. Logic that needs a
regression test still belongs in `lib/`; behaviour that only exists on screen (a row
opening unpressed, a save refusing, a confirm appearing) belongs in `tests/e2e/`.

`npm run test:e2e` **is a gate too, on the two merge-blocking device projects**
(`iphone-safari`, `android-chrome`): the `e2e` job in `.github/workflows/ci.yml`
builds a local stack the way the `db` job does, seeds the shared accounts with
`scripts/seed-e2e-accounts.mjs`, and serves a production build, because
`playwright.config.ts` runs `next start` under `CI`. It reaches no model -
`OPENAI_BASE_URL` points at a closed port - so a spec that needs one cannot pass
there. A manual dispatch with `all_devices` runs all six projects. The script
still skips under `CI` unless `RUN_E2E=1`, which the job sets. `TESTING.md` owns
the environment, and a new spec is watched failing before it passes.

`npm run test:db` **is** a gate: `tests/db/` needs no browser or dev server, so CI
starts a local stack from `supabase/migrations/` and runs it on every pull
request. Behaviour that lives in the database - a write's atomicity, a policy, a
cap, which row a lookup lands on - is proven there rather than with a queued fake
of the client, which has to script every query in order and breaks on changes a
rider cannot see. `playwright.db.config.ts` refuses to run without a stack, since
a suite that skips reports green, and refuses any Supabase URL that is not
loopback, since the specs create and delete riders with the service role.

