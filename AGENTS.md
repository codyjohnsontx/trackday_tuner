# CLAUDE.md

## Project Overview

Mobile-first motorsport setup logger. Users log vehicle setups per track session (tires, suspension, etc.) and compare across sessions.

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 19, TypeScript 5 strict
- **Styling**: Tailwind CSS v4, dark theme only, design tokens in `@theme` (canvas bg, sodium-amber `signal` accent)
- **UI**: shadcn/ui pattern — `cva` + `cn()` from `lib/utils.ts`, Radix primitives
- **Backend/Auth**: Supabase (email/password)
- **Payments**: Stripe (subscriptions)
- **AI**: OpenAI-backed setup advice and day planning with curated RAG context
- **Hosting**: Vercel

## Git Protocol

- Run git commands one at a time, synchronously — never chain or background them
- Stop and report on any failure — do not retry or work around it automatically
- Do not run any git command if the working tree is dirty — stop and tell the user to clean it up first

## Instruction File Sync

- `AGENTS.md` is the Codex-readable mirror of this file
- `CLAUDE.md` and `AGENTS.md` must stay byte-for-byte identical
- After editing either file, immediately sync the other one and run `npm run check:agent-docs`

## Duplicate File Hygiene

- Treat files or directories with Finder-style duplicate names such as `* 2.ts`, `* 2.tsx`, `* 2.mjs`, `* 2.sql`, `* 2.json`, or folders whose names end with a space followed by `2` as accidental artifacts unless the user explicitly asked for them
- Do not create duplicate working copies in the repo as a drafting workflow
- If duplicate artifacts are found, stop and tell the user before proceeding with git operations
- Remove accidental duplicates before creating a PR so they do not remain as untracked clutter across branch switches

### Creating a PR (exact steps, no deviation)

- PRs are opened as drafts by default, so step 7 uses `gh pr create --draft`. CodeRabbit does not review draft pull requests, so the pipeline's own fix commits cost no review quota while the branch is still being worked. The author marks the pull request ready for review when their review quota allows; an agent never does that, and never converts a draft to ready.
- Every entry in `path_filters` in `.coderabbit.yaml` must begin with `!`. An entry without one is an include, not an exclude, and a single include narrows the whole review to only what it matches, skipping everything else silently. Check this before editing that file.

1. `git status` — working tree must be clean. If not, stop and tell the user.
2. `ls .git/index.lock 2>/dev/null` — if lock exists, stop and tell the user. Do not delete it.
3. `gh pr list --head <branch>` — if a PR already exists, show it to the user and stop.
4. `git log --oneline main..HEAD` — show the user exactly which commits are going up. Wait for confirmation before continuing.
5. `git push -u origin HEAD` — wait for it to fully complete before proceeding. If it fails, report the error and stop.
6. `git branch -vv` — confirm the branch now shows a remote tracking ref. If not, stop.
7. `gh pr create --draft --title "<concise title>" --body "<summary + test plan>"` — write an explicit title and body. Do not use `--fill`.

**Never** run extra staging, committing, stashing, or branch operations unless explicitly asked. If the push is slow, wait — do not retry or run a second push in parallel.

### How PRs land

- PRs merge with a **merge commit** — `gh pr merge <n> --merge`. The merge commit takes the PR title as its message with a blank body. Squash merging is disabled on the repository; rebase merging is allowed but is not the default
- Every commit on the branch lands on `main`, so each one must stand on its own. No `wip`, no `fix typo`, no commits that only make sense next to the one after them
- Review-response work is a normal commit describing what changed and why, not an amendment to the original. Pushing it does not trigger a second CodeRabbit review: incremental review is off in `.coderabbit.yaml`, so a re-review is requested with `@coderabbitai review` once the branch is ready
- `git log --first-parent --oneline` gives the one-line-per-PR view of `main`; plain `git log` gives the full detail
- The remote branch is deleted automatically on merge. Clean up locally with `git checkout main`, `git pull --ff-only`, `git branch -d <branch>`, `git remote prune origin`
- Merging is the user's call. Open the PR, report it, and stop

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run test:unit    # vitest unit tests
npm run test:e2e     # playwright e2e tests
npm run lint         # eslint
npx tsc --noEmit     # type check (run after build so .next/types exist)
npm run rag:index    # build RAG index from docs/knowledge-base/
npm run db:status    # which migrations are applied on the linked project
npm run db:new <name>  # scaffold a migration
npm run db:push      # apply pending migrations to the linked project
```

**Never run `npm run build` while a dev server is up.** They share `.next`, and
the build overwrites the dev chunk manifest. The running server then 404s on
`/_next/static/chunks/main-app.js`, so pages still render but React never
hydrates and every click silently does nothing — it looks exactly like a broken
component. Recover with `rm -rf .next` and restart dev.

## Database Migrations

Migrations live in `supabase/migrations/` and are applied with the Supabase CLI
against the linked hosted project. `supabase_migrations.schema_migrations` on
the remote is the source of truth for what has been applied.

- `npm run db:status` before and after any schema work. It compares the applied
  migration *history* — which versions the remote has recorded — against the
  files in `supabase/migrations/`. Three migrations were once applied by hand
  and silently skipped, which surfaced months later as `PGRST202 Could not find
  the function public.replace_session_laps` when a rider saved lap times
- `db:status` cannot see changes made outside a migration, so a table altered by
  hand in the dashboard still reads as "up to date". Use
  `npx supabase db diff --linked` for that: it diffs the live schema against
  what the migration files describe and prints the SQL that would reconcile
  them. Empty output means no difference *the diff engine models* was found —
  not that the two are identical. The comparison is done by a pluggable engine
  (`--use-migra`, `--use-pgadmin`, `--use-pg-schema`, `--use-pg-delta`), and
  coverage varies between them. Publications, storage buckets, and
  `security_invoker` on views are known to slip through, so anything in that
  territory still needs checking by hand
- **Never edit a migration that has already been applied.** The remote records
  it by version, so an edit changes the file without changing the database and
  `db push` will never re-run it. Corrections go in a new migration.
  **This includes comments.** A comment-only edit looks obviously safe, and that
  is the problem: the rule survives because nobody has to judge whether a given
  edit is harmless, and it stops working the moment the first exception is
  granted. A stale comment in an applied file is corrected *here*, in this
  document, next to the migration notes that explain it - see the note on the
  baseline's `profiles` comment below
- Filenames are `<14-digit timestamp>_<name>.sql`. The timestamp is the version
  recorded remotely and is a primary key, so **two migrations must never share a
  prefix** — an earlier pair both named `20260224_` could not both be recorded
- `create table`, `create index`, and `create function` statements are written
  idempotently (`if not exists` / `or replace`). `create policy` is not, so a
  half-applied migration cannot simply be replayed — check `db:status` first. The
  baseline below is the one exception: it drops each policy first, because it is
  written to meet a database that already has those tables
- Applying requires `supabase login` and `supabase link`, which need a personal
  access token and the database password. Those are interactive and belong to
  the operator, not to CI or an agent

### Building a database from nothing

`supabase start` on a clean machine builds the whole schema. Two files exist only
to make that true, and both are easy to undo by accident:

- `20260223000000_init_baseline_schema.sql` creates `profiles`, `vehicles`,
  `tracks` and `sessions`. Those four were originally made by hand in the
  dashboard, so nothing created them and the second migration died on
  `relation "public.profiles" does not exist`. It is dated *before* the rest of
  the history on purpose, and holds the tables' **original** shape - later
  migrations still add the columns they always added
- `20260719001100_grant_data_api_access.sql` is the only place the Data API roles
  get table access. Nothing in the repo granted any before it. The hosted project
  never noticed because it predates the change and still carries Supabase's legacy
  auto-expose defaults; a project created today does not (see
  `auto_expose_new_tables` in `supabase/config.toml`), so it applied every
  migration cleanly and then answered every PostgREST request with
  `permission denied for table ...`

`20260816001200_add_profile_on_auth_user_created.sql` is **not** one of those two.
It is the only thing that puts a row in `profiles` for a rider who did not arrive
through the beta invite route, so it is a production fix for existing deployments
just as much as it is part of a clean build - an environment that skips it keeps
the bug on every other signup path, whatever its schema was built from.

**`profiles` is written by a trigger on `auth.users`, and it has to be.** A rider
signing up through the ordinary form once `BETA_INVITE_ONLY` is off goes from the
browser straight to GoTrue (`components/auth/auth-form.tsx` calls
`supabase.auth.signUp`), and an OAuth signup is GoTrue talking to the provider.
Neither reaches a route handler before the account exists, so **there is no
application choke point to put this in** - the nearest thing, `getRealUser()` in
`lib/auth.ts`, is on the read path of every authenticated page and would need the
admin client anyway, since `authenticated` deliberately holds no INSERT here.

Reading a missing row degrades correctly - `resolveUserAccess(null)` is the free
tier - which is why this stayed invisible. Paying does not:
`app/api/stripe/checkout/route.ts` attaches the Stripe customer by updating
`profiles` and correctly refuses to charge when the update matches nothing, so a
rider with no row gets `Unable to link your billing account` **forever**. That was
reproduced end to end against a local stack and is written up in the migration.

`tests/unit/migrations-bootstrap.test.ts` fails if that trigger goes missing, ends
up disabled, or stops inserting into `profiles`. Like everything else in that file
it reads SQL as text: it cannot prove the insert *succeeds*, which depends on
`security definer`, the owner's privileges and the pinned empty `search_path`.
Only signing up against a real database shows that.
`tests/e2e/signup-creates-profile.spec.ts` is that walk, and it skips unless
`BETA_INVITE_ONLY` is `false`, because with invite-only on the form posts to the
route that always wrote the row - see `TESTING.md` for what it needs.

**The baseline says the opposite, and it is right about the day it was written.**
`20260223000000_init_baseline_schema.sql` states that nothing creates a `profiles`
row automatically and that the beta signup route is the one writer. That was true
until `20260816001200`, and it is the reason the table has select and update
policies for a user's own row but no insert policy. It is left standing rather than
corrected in place because **an applied migration is never edited** - not even its
comments. The rule is worth more as a bright line than as a judgement call, and the
argument for a comment-only exception rests on what the CLI does with a changed
file rather than on anything this repository can verify. This paragraph is the
correction; read the two files together. The policies themselves need no change,
because the trigger inserts as the function's owner rather than as the rider, so
there is still no insert policy to add.

**Grants are per role and per table, and that is a security boundary rather than
tidiness.** `anon` gets no table access at all, `service_role` gets everything
schema-wide, and `authenticated` is granted table by table. `profiles` is
`select` only for it.

The reason is worth knowing before widening any of it. **RLS chooses which ROW a
policy admits and cannot restrict which COLUMN is written.** So while
`profiles: update own` correctly limits a user to their own row, any `update`
privilege on that table would also let them set `tier`, `beta_access_expires_at`
and the Stripe identifiers on it, which `lib/access.ts` reads as paid access. That
was reproduced against a rebuilt database, twice, as a plain `PATCH` carrying only
the public key and the user's own session. Withholding the privilege is the fix;
no policy can be written that would do it. The one legitimate user-context write
to that table, the Stripe customer link, runs through the admin client inside an
already authenticated route (`app/api/stripe/checkout/route.ts`).

The default privileges match: future tables reach `service_role` and never the
Data API roles, so a migration adding a table grants what that table needs. The
file also has to `revoke` before it grants, because the CLI itself hands `anon`
and `authenticated` truncate, references and trigger, and RLS does not apply to
truncate. `tests/unit/migrations-bootstrap.test.ts` fails on any migration that
grants those roles more than `select` on `profiles`, or that reaches them with a
schema-wide or default table grant

What it builds is the schema and nothing else. The repository does not provision
the `vehicle-photos` storage bucket that `components/garage/vehicle-form.tsx`
uploads to, so adding a vehicle with a photo fails with `Bucket not found` until
that bucket is created out of band, and no tracks are seeded.

Functions are deliberately *not* granted schema-wide. RLS contains a table; it does
not contain a `security definer` function, which runs as its owner and bypasses
every policy, so for a function the grant *is* the access control. Execute belongs
to the migration that creates the function, which is the only place its caller is
known - see the `revoke` / `grant execute` pairs on `create_beta_invite` and
`consume_beta_rate_limit`. When that migration is already applied on the remote,
editing it would change the file and not the database, so the pair goes in a new
migration instead: `20260719001100` carries the pairs for `save_session_outcome`
and `record_race_engineer_memory_feedback` for that reason. The routines default
privilege therefore revokes execute from `public` rather than granting it.

That revoke is a declaration of intent, not a guarantee, and the difference was
measured rather than reasoned about. It is recorded correctly in `pg_default_acl`,
but on a rebuilt local stack a function created afterwards still comes out with a
null `proacl`, which is Postgres's built-in `execute` to `public`. The same
statement against `tables` does take effect, so the mechanism works and this one
case does not. **A new function is world-executable until its own migration revokes
it.**

So the migration has to say so itself, and
`tests/unit/migrations-bootstrap.test.ts` now fails a `security definer` function
whose migration does not. Either statement satisfies it, because the requirement is
that the decision is written down and not that every function is locked:

```sql
revoke all on function public.f(...) from public, anon, authenticated;  -- locked
grant execute on function public.f(...) to public;                      -- open, on purpose
```

Both name `public`, which is the only role that settles it: `anon` and
`authenticated` are *members* of `public`, so revoking from those two by name while
public still holds execute reads like a lockdown and closes nothing. That near-miss
has its own fixture. `security invoker` functions are out of scope - they run as
their caller, so RLS still applies and execute is not the access control.

The check requires the decision in the function's **own** migration, because the
gap between two migrations is a window in which a `security definer` function is
world-executable. Note that `20260719001100` revokes `save_session_outcome` and
`record_race_engineer_memory_feedback` in a later migration than the one creating
them. That is fine for those two, which are `security invoker`, but a
`security definer` function written that way is flagged on purpose.

`tests/unit/migrations-bootstrap.test.ts` reads the SQL as text and fails if a
migration alters or references a table nothing earlier creates, if those grants go
missing, if a `security definer` function arrives without that decision, if a
migration re-grants execute schema-wide over a per-function `revoke`, or if the
migrations end with nothing writing `profiles` on signup (above). It cannot
tell you a migration *runs* - only `supabase start` from a destroyed local stack
proves that, and only then exercising the app against it proves PostgREST can see
the result. It reads the decision rather than its effect, so once `public` is
named, a revoke listing the wrong roles beside it still passes.

The wrong SQL it is meant to catch lives in `tests/fixtures/migration-guard/`,
outside `supabase/migrations/` so no Supabase command applies it. Each check was
watched failing against those files before it was written, because a guard that has
only ever been run against a repository that gets it right proves nothing.

The baseline is dated before migrations the remote has already recorded, so
`db push` will report it as out of order and refuse without `--include-all`.

Do not reach for `migration repair` on reflex. The baseline is not a pure no-op
against a database that already has these tables: `create table if not exists`
skips, but each policy is preceded by `drop policy if exists`, so running it
replaces the live policies with the ones in this file. Those were reconstructed
from `types/supabase.ts` and the application's queries, not read off the hosted
project, so they may not match what is actually there. Compare the live policy
definitions against this file first (`pg_policies` in the SQL editor, or
`npx supabase db diff --linked`). Only once they agree, record it as applied
rather than running it:
`supabase migration repair --status applied 20260223000000`. If they disagree,
that difference is the real finding and needs deciding before anything is
recorded.

## Project Structure

```text
app/(app)/           # authenticated routes (layout enforces auth)
app/api/             # API routes (stripe checkout/portal/webhooks/AI)
components/ui/       # shadcn/ui-backed component wrappers
components/layout/   # app shell, bottom nav
components/auth/     # auth form, set-password form
components/sessions/ # session form
components/garage/   # vehicle form
lib/actions/         # server actions (sessions, tracks, vehicles, sag)
lib/rag/             # RAG retrieval, prompt, policy, and validation helpers
lib/supabase/        # client, server, middleware, admin clients
lib/auth/            # OAuth providers, next-path sanitizing, auth error copy
lib/auth.ts          # getViewer(), isAuthenticated()
lib/utils.ts         # cn() utility (twMerge + clsx)
lib/billing.ts       # plan/tier helpers
lib/plans.ts         # plan definitions
docs/knowledge-base/ # curated markdown source files for RAG index
data/session-logs/   # sample session log JSON
```

## UI Component Rules

- All UI primitives live in `components/ui/`
- Use `cn()` from `@/lib/utils` for all class composition — never string concatenation
- Use `cva` for multi-variant components (Button, Badge, Card)
- `Select` stays as native `<select>` (mobile-first; Radix Select degrades on touch)
- Radix primitives in use: `@radix-ui/react-slot` (Button), `@radix-ui/react-toggle-group` (SegmentedControl), `@radix-ui/react-tooltip` (InfoTooltip)
- Keep `*.custom.tsx` backup files until visual QA is confirmed, then delete

## Design Conventions

- Dark mode only — no light mode
- Mobile-first, max-width-md (448px) app shell
- 44px minimum touch targets
- Use the tokens in `app/globals.css`, never raw palette classes (`zinc-*`, `cyan-*`, `amber-*`)

**Surfaces.** Separation comes from a lightness ramp, not borders. `canvas` is the
page, `surface` a card on it, `surface-2` a row nested in that card, `surface-3` a
control on that row. Never skip a step, and never nest deeper than `surface-3`.
Radii tighten with depth: `rounded-card` → `rounded-row` → `rounded-plate`; buttons
and chips are `rounded-full`.

**Ink.** `ink` for primary text, `ink-dim` for secondary, `ink-faint` for eyebrows
and metadata. Dark ink on a bright fill is `text-canvas`, never `ink-faint`.

**Accent.** `signal` (sodium amber `#ffb020`) is the only accent and marks
*interaction or caution*: active tab, focus ring, warnings, live markers. It never
encodes data and never labels a section — an uppercase eyebrow is `ink-faint`.
Data semantics are `faster` (green) and `slower` (red), which is why the accent is
deliberately neither. Primary buttons are a white pill (`bg-ink text-canvas`), not
an accent fill, so the accent stays scarce enough to mean something.

**Type.** `font-display` (Instrument Serif) is for page titles only — use
`PageHeader` or `pageTitleClass`. Everything carrying a measurement stays on the
system sans. Digits are tabular by default.

**Primitives.** Compose screens from `components/ui/surface.tsx` (`Card`,
`CardGroup`, `GroupRow`, `Eyebrow`, `SectionHeader`), `PageHeader`, and `DataPlate`
rather than hand-rolling card markup.

## CSS Variables

`app/globals.css` defines no shadcn CSS variables - the project follows the
shadcn *pattern* (`cva` + `cn()`) but not its token set. Tailwind v4 project
tokens live in `@theme { ... }`; the only `:root` block is a `color-scheme`
declaration inside `@layer base`. Those are separate namespaces, no collision.

## Cascade Layers

**Every rule in `app/globals.css` must sit inside a layer**: `@layer base` for
element defaults, `@layer components` for helper classes. Tailwind v4 emits all
utilities inside `@layer utilities`, and unlayered CSS beats layered CSS at any
specificity, so one unlayered rule silently outranks a whole family of utilities
with no warning from the build, the linter, or the types. Layers rank by first
declaration, so the layer has to be one Tailwind declares before `utilities`: a
layer of your own is first declared after them and outranks every utility exactly
the way an unlayered rule does, and `utilities` itself is not somewhere to write.
An `@import` cannot be wrapped in a layer, so it carries a `layer(...)` clause
naming one of those layers instead - only `tailwindcss` itself arrives already
layered.

`tests/unit/globals-css-layers.test.ts` enforces this and runs in the required
checks; the comments in `app/globals.css` record why each block is layered. That
guard reads one file, so a contrast regression arriving any other way - a changed
token, a Button variant, a new component - still needs a browser. Only the manual
e2e suite asserts a rendered colour.

## Path Alias

`@/*` maps to project root.

## Leaving Demo Mode

`/demo/exit` clears the demo cookie and redirects to `/login`, or to a sanitized
`?next=` when the caller has somewhere specific to send the rider. Only
`app/reset-password/page.tsx` passes one, and it has to: `/auth/callback` trades
a recovery code for a real session before the reset form ever renders, so the
plain exit sends an already-signed-in rider through `/login` to `/dashboard`,
which has no route back to the form and no mention that a reset was underway.

It is a route handler that changes state on GET, and Next prefetches `<Link>`
targets - on hover in dev, on viewport entry in a production build - which runs
the handler and drops the demo cookie before the rider has clicked anything.
Links to it therefore carry `prefetch={false}` or use a plain `<a>`, as
`components/demo/demo-banner.tsx` does. No spec guards that: the e2e suite runs
`next dev`, which does not prefetch on viewport, so it was checked by building
with and without the flag and watching the cookie survive or vanish on render.

## Supabase Notes

- Use `lib/supabase/server.ts` in Server Components and Route Handlers
- Use `lib/supabase/client.ts` in Client Components
- `lib/supabase/middleware.ts` handles session refresh — runs via `middleware.ts`
- Admin client (`lib/supabase/admin.ts`) uses service role key — server only
- `sessions.start_time` is nullable, and PostgREST filters inherit SQL NULL
  semantics, so `start_time.lt.<t>` silently drops every row that has none. Session
  ordering is defined once, in `isSessionBefore` / `compareSessionsDesc`
  (`lib/session-compare.ts`), which coalesce a missing start time to `00:00:00` and
  fall back to `created_at`. Reach for `fetchPreviousSession`
  (`lib/session-previous.ts`) rather than writing a fourth predicate: three call
  sites once hand-rolled the raw filter and all three went blind to same-day
  sessions logged without a start time
- The same rule governs **list ordering**, and a track day is the case that exposes
  it: every session shares a `date`, so `.order('date')` alone leaves the whole day
  tied and the tie broken by whatever the planner emits. Any query selecting whole
  session rows orders `date`, then `start_time` with `nullsFirst: false`, then
  `created_at` - the SQL mirror of `compareSessionsDesc`. `getSessions` once ordered
  on `date` alone, which listed a rider's day backwards and left the session they had
  just finished off the dashboard's three-row "Recent" list. It is invisible in demo
  mode, where `getDemoSessions` sorts in TypeScript with the shared comparator, so
  this class of bug needs a real account to see.
  `tests/unit/session-list-ordering.test.ts` guards it
- **A per-vehicle fact has to come from that vehicle's own sessions.** `getVehicles`
  orders `created_at` ascending, so `vehicles[0]` is the *oldest* vehicle. The
  dashboard hero paired that nickname with the newest session of *any* vehicle, so a
  rider with a second bike read their new bike's track day under their old bike's
  name. `resolveDashboardHeroSubject` (`lib/dashboard-hero.ts`) returns the name and
  the session together so the two cannot be picked off different lists.
  `lib/dashboard-hero.test.ts` guards it

## What a Rider Told You

Three of this app's stored fields are answers, and a default is not one. The
session form's weather and tire-condition rows and the outcome panel's verdict
all once opened with an option pressed, so a rider who scrolled past filed a
claim into the setup diff, the prompts and the recommendation learning record.
`lib/session-answers.ts` holds the rule and `ChoiceRow`
(`components/ui/choice-row.tsx`) renders a row where `null` is a value. Which of
the three blocks a save follows the column: `sessions.conditions` and
`session_feedback.outcome` are NOT NULL so they are required, and
`tires.condition` is inside JSON so it stores null.

The same shape applies to anything derived rather than given:

- **Dates** come from `todayLocalDate` (`lib/local-date.ts`), never
  `toISOString()`, which is UTC and hands an evening rider west of Greenwich
  tomorrow's date. The rider's calendar day is only knowable in their browser, so
  it is seeded on mount rather than during SSR
- **Lap times** live in a `LapEditorValue` (`lib/lap-times.ts`) that carries the
  editor's entry boxes alongside the list. A save has to run
  `commitLapEditorValue` to get a lap array at all, because text a rider typed
  but never pressed "Add" on used to be dropped silently
- **Track names** are resolved server-side by `resolveSessionTrack` in
  `lib/actions/sessions.ts`, using `lib/session-track.ts` to fold case, spacing
  and accent composition. A supplied `track_id` is looked up in the same
  seeded-or-own scope the picker offers rather than trusted, and the row's own
  name wins over what was typed, so a session cannot store an id and a name that
  point at different circuits. Creating a row for a name that matches none is
  best effort: at the free-plan track cap, on an insert error, or when the name
  lookup could not answer - it failed, or filled `TRACK_NAME_MATCH_LIMIT` and so
  proves nothing - the session still saves with the name alone, and a row this
  code did create is deleted again when the session it was written for does not
  survive

## Units

Temperature is stored in Celsius in every column, prompt and export.
`lib/temperature.ts` is the only place it becomes a number a rider reads or
types, and their unit is a device preference (localStorage, like the 12h/24h
clock) read through `useTemperatureUnit` (`components/ui/temperature-display.tsx`).
Text a rider is still typing belongs in `useTemperatureInput` from that same file,
which re-expresses it when the unit changes and knows the preference arriving from
storage on mount is not a change. Convert at the edge; never widen a stored column.

The session comparison page is the exception and still prints Celsius: its rows
and context-flag strings are built server-side in `lib/session-compare.ts`, where
a localStorage preference cannot be read.

## What the Test Suites Cover

`vitest.config.ts` collects `app/**`, `lib/**` and `tests/unit/**` only, and the
project has no React testing library and no DOM, so **nothing in the unit suite is
interactive**. A suite can still `renderToStaticMarkup` a component and read the
attributes back - `vitest.config.ts` sets `esbuild.jsx: 'automatic'` so an imported
`.tsx` compiles, since tsconfig's `jsx: preserve` would otherwise fail it with
`React is not defined`. That reaches structural facts about one render
(`tests/unit/input-label-association.test.ts`, `tests/unit/sag-percentage-basis.test.ts`)
and nothing that needs a click, a state change or a layout. Logic that needs a
regression test still belongs in `lib/`; behaviour that only exists on screen (a row
opening unpressed, a save refusing, a confirm appearing) belongs in `tests/e2e/`.

`npm run test:e2e` **skips itself in CI** unless `RUN_E2E=1`, so an e2e spec is
evidence a change works, not a gate that will catch its regression. Run the specs
locally against a Supabase stack - `TESTING.md` owns the environment they need -
and watch each new one fail before it passes.

## Current AI Status

Two AI routes reach the model: `/api/ai/tuning-advice` and `/api/ai/day-plan`.
`/api/ai/recommendation-feedback` is a 410 tombstone; that feedback is
recorded through the session outcome flow instead.
`lib/rag/` contains retrieval, prompt, policy, validation, and schema helpers.
Knowledge-base markdown lives in `docs/knowledge-base/` and can be indexed with `npm run rag:index`.

**Every route that puts rider text in front of the model runs the same four
guards, from shared modules rather than per-route copies**: `isUuid` and
`AI_REQUEST_MAX_BODY_BYTES` (`lib/rag/validation.ts`), the prompt-injection screen
in `lib/rag/domain-guard.ts`, `evaluateAdvicePolicy` (`lib/rag/policy.ts`) over
whatever the model returns, and the `ai_requests` audit row plus the rate limiting
built on it (`lib/rag/ai-request-log.ts`). That limit counts per rider and not per
route, so every AI entry point draws on one budget and each is visible to the
others' count. The body read, refusal throttle, reservation, counting and limit
responses are one function - `preflightAiRequest` (`lib/rag/ai-request-preflight.ts`) -
because duplicated safety control flow drifts toward whichever copy nobody reads.
`app/api/ai/tuning-advice/route.characterization.test.ts` locks that route's
status, body, headers, recommendation id and audit row across 19 paths so a change
to the shared pipeline cannot move it unnoticed. Eighteen of those are refusals
and failures; the nineteenth is the ordinary 200 that delivers advice, which was
missing because the fixture recommended `softer` and the real policy refused it -
a lock that covers only the paths nobody takes proves the pipeline stayed still
everywhere except where it matters.

**Injection screening takes two passes, and the second is the one that gets
forgotten.** Every rider-authored field a request submits is screened early, each on
its own rather than joined, so two innocent fields cannot be concatenated into a
phrase neither contains. On tuning-advice that is the question, the symptom tags and
the change intent, because `formatMetaBlock` prints all three into the prompt; on
day-plan the screen runs before the reservation and before the vehicle lookup, so a
refusal costs no slot and no read of the rider's own rows, and is still recorded
(`recordRefusedRequest`) where the throttle can count it. But the prompt also
interpolates text the rider stored *earlier* - vehicle nickname, session notes,
feedback notes, rider memory, every suspension and alignment string - and
`sanitizeFreeText` in `lib/rag/prompt.ts` neutralises only the `<user_data>` tag
delimiters, not phrases.
`classifyStoredRiderText` runs over that after the read, which is why it cannot
replace the first pass.

**The second pass covers one of the two routes, and that is a filed gap rather
than a description of the design.** Only `/api/ai/day-plan` calls
`classifyStoredRiderText`; `/api/ai/tuning-advice` interpolates the same stored
fields - session notes, previous-session notes, vehicle nickname, and through
`formatRaceEngineerContext` the rider-memory summary, similar-session notes and
feedback notes - and screens none of them. Closing it needs a second collector
built from that route's own prompt input and is tracked as
tt-stored-text-screen-tuning-advice. The note lives on `classifyStoredRiderText`
itself, because a guard on one of two twins reads as covering both.

The order around that first pass is load-bearing in both directions.
`preflightAiRequest` is deliberately splittable - `checkAiRefusalThrottle` then
`reserveAiRequestSlot` - because a route that screens before touching the database
needs the throttle on one side of the screen and the reservation on the other. Put
the whole preflight after the screen and a probe costs nothing but also *counts*
nothing, so the one path that refuses can be looped forever. Put it before and
every refused probe spends a slot. Day-plan runs throttle, screen, reserve;
tuning-advice classifies after the whole preflight and needs no split.

**The two passes are not the same screen, and the asymmetry is deliberate.** The
list of stored fields comes from `collectDayPlanRiderText` in `lib/rag/prompt.ts`,
beside the formatters, and takes the prompt builder's own input type - a
hand-maintained second list is what let feedback notes and suspension strings reach
the model unscreened. Stored text then runs a *narrower* pattern set than submitted
text: `/\bact as\b/i` is out of it, because "the instructor said to act as if the
apex is later" is an ordinary session note and a stored false positive refuses every
plan the rider asks for rather than one request they can retype. For the same
reason the refusal names the field (`the notes on your 2026-08-01 session`) rather
than echoing the text, and is audited as
`STORED_TEXT_INJECTION_REFUSAL_STATUS` - a status `isRefusalThrottled` does not
count. Counting it would spend the injection budget three plans in and 429 the
rider out of tuning-advice too, over a note they wrote weeks ago.

**The vocabulary the policy enforces is also the vocabulary the model is told**,
generated rather than hand-copied. `lib/rag/component-vocabulary.ts` holds the
components, directions, units and magnitude ceilings; `evaluateAdvicePolicy`
checks against it and `describeComponentVocabulary()` renders it into
`SYSTEM_PROMPT`. It had lived only in the policy - `SYSTEM_PROMPT` named no
component, `component` and `direction` are bare strings in the schema, and the
canonical spelling survived as an example in a spec document - so the model was
asked for words it had never been shown and then refused for guessing them. The
repository's own fixture recommends `front_rebound` / `softer` / `1 click`, which
the policy rejects because it accepts `soften` and not `softer`: one letter
between a real recommendation and a withheld one. Add a component or a direction
in that one file and both sides learn it together. `demoDayPlanAdvice` in
`components/ai/day-plan-panel.tsx` uses the same vocabulary, because a demo
showing a plan the policy would refuse advertises a product that does not exist.

**A closed vocabulary is matched by equality, never by containment.**
`directionAllowed` once asked whether the canonical word appeared *somewhere* in
the model's `direction` (`/\bincrease\b/i.test(direction)`), so `do not
increase` and `never increase` passed with a valid component and a legal
magnitude and were stored and rendered to the rider as checked recommendations
instructing the opposite. Thirteen ordinary negation prefixes swept across the
table accepted 518 such values. The fix is not a negation detector - that is an
arms race against English - but normalized equality against the accepted set,
which `SYSTEM_PROMPT` makes affordable because
`describeComponentVocabulary()` now prints those exact strings to the model.
Casing, surrounding whitespace and the separator run (`_`, `-`, repeated spaces)
are folded through the one `directionKey` the rider-facing label already uses, so
the guard and the label cannot disagree about what a value is; everything else is
refused, including a paraphrase that names the component back
(`increase tire pressure`) and a direction curated for a different component.
The accepted cost is a refusal on that paraphrase, which is the fail-safe
direction. Nothing stored is re-checked, so no existing `ai_recommendations` row
changes how it reads. The remaining containment matcher in that file is
`magnitudeAllowed`, and it is a different class: a magnitude is inherently a
phrase, so there is no closed set to compare against.

**Containment holds there for padding and not for sign, and that is a known
accepted gap.** `parseRangeMax` takes the largest number present, so extra prose
can only raise the figure checked against the ceiling and can only tighten it -
but it takes that number through `Math.abs`, so a negative magnitude clears the
ceiling today. `{component: front_rebound, direction: soften, magnitude: '-1
click'}` passes both guards, is persisted, and reaches the rider rendered raw as
`Soften · -1 click`, because the display/wire split deliberately leaves
`magnitude` unformatted. It is recorded rather than fixed because the earlier
claim here ("padding one can only tighten the ceiling") talked the gap away, and
a false justification is worse than an undocumented gap: the gap is merely
unknown, while the justification actively stops the next reader ever opening
`parseRangeMax`. A comment that defends a bug outlives the code. Pre-existing,
out of scope for the equality change, tracked as tt-negative-magnitude-accepted;
the earliest shared boundary for closing it is `parseRangeMax` /
`magnitudeAllowed`, not a render site.

**An empty `recommended_changes` list is checked as prose.** `evaluateAdvicePolicy`
validates component, direction and magnitude by iterating the structured field, so
when `allowEmptyRecommendations` is on, a model that puts the instruction in
`summary` instead would walk past every check while the rider reads it. Guarding
the structured field while the rider reads the prose field is a guard-shaped
object, not a guard.

Two things bound that check, and both were paid for in false refusals rather than
reasoned out. It reads **`summary` and nothing else** - `tradeoffs`, `prediction`
and `personal_evidence` are read as consequences, forecasts and history, and every
false positive came from scanning them; a warming-day `day_trend` is the shape the
day-plan prompt asks for, so refusing over it discarded the very answer
`allowEmptyRecommendations` exists to preserve. And it matches a **delta**, not any
quantity, and government is the whole test - a change VERB has to reach the
number, and ORDER is what carries that. It reaches two ways: across anything that
is not another change verb when the delta preposition names the number
("increase THE front tire pressure by 1 psi"), or across at most three plain
words when nothing does ("soften front rebound 1 click"). So "increase front tire
pressure by 6 psi" is refused, while "your 30 psi cold baseline" is not, and
neither is "rear hot pressure came up by 2 psi over cold, and ambient will
increase again today" - there the number comes first, which makes it a report.

**The unit it reads is a clause, not a sentence.** A comma-joined sentence carries
more than one intent, so a forecast verb in the first clause was governing a
reported delta in the second and refusing a plan that instructed nothing. The
summary splits on sentence terminators *and* on a comma followed by a connective;
a bare "and" deliberately does not split, because "front and rear cold tire
pressure" is one noun phrase and splitting there stops a real instruction being
caught at all. **A decimal point is not a boundary** either - a bare `.` in the
terminator class tore "by 0.5 psi" into "by 0" and "5 psi" and let the most common
recommendation in this product escape, since the tire-pressure ceiling is 1 psi.
Both fixes are to the unit of analysis rather than to the pattern, which is what
closed that class.

The guard is **best-effort by design and closed to further pattern work**. It is
deliberately incomplete, with two gaps accepted on the record: an instruction
carrying no numeric delta ("front tyres want another half psi"), and every legal
camber change, because `degrees` is kept out of the quantity pattern so a
temperature forecast is not read as a setup change. The prompt contract
carries that half instead, since `describeComponentVocabulary()` tells the model
prose instructions are discarded with the whole response. Every widening of this
pattern has cost a false refusal on a paid route, so a case that escapes is to be
**recorded rather than chased** with another pattern change; a real recommendation
belongs in `recommended_changes` where the magnitude ceiling can see it. The refusal copy is day-plan wording, because
`allowEmptyRecommendations` has exactly one caller and that panel has no question
box to ask anything in.

**The wire vocabulary is identifiers; what a rider reads is not.** The class is
any model-supplied identifier reaching a rider-facing render, not one field:
`formatComponentLabel` and `formatDirectionLabel`
(`lib/rag/component-vocabulary.ts`) are the one place a `component` and a
`direction` become display text, so a recommendation reads "Front rebound ·
Soften" rather than "front_rebound · soften". The model is told to emit `rear_tire_pressure`
exactly, so formatting at the panel rather than reordering the prompt's alias list
is deliberate: a rider-facing guarantee must not rest on the model picking the
prettier synonym. Anything the table does not recognise passes through unchanged,
which is what keeps pre-vocabulary rows like "Front setup" readable.

Which sites format and which stay raw is the display/wire split, and the helpers'
own doc comments carry the list, the sweep that produced it, and why `magnitude`,
`summary`, `reason` and `confidence` are deliberately left raw. It is worth
reading before adding a render: the helper was added for the two AI panels and the
outcome picker in `components/sessions/session-outcome-panel.tsx` was found
separately, afterwards, once `SYSTEM_PROMPT` started making every stored
`ai_recommendations` row an identifier rather than prose. Both demo fixtures are
held to the same bar - `tests/unit/demo-advice-vocabulary.test.ts` runs the real
`evaluateAdvicePolicy` over the objects the panels render.

`/api/ai/day-plan` shipped with none of them, and with a hand-copied UUID pattern
that had four groups instead of five. It therefore rejected every genuine
`vehicle_id` and was inert in production for its whole life - the broken regex is
the only reason an unguarded AI route was never actually exercised. Two rules come
out of that: **a new AI route composes those modules rather than restating them**,
and **a route with no test is not known to run at all**. Both AI POST handlers now
have one (`app/api/ai/*/route.test.ts`); they mock Supabase and the model but leave
the guards themselves real, so the refusal they assert is the refusal a rider gets.

The two classifiers are not interchangeable. `classifyRaceEngineerQuestion` also
refuses out-of-domain requests, an arm that reads the free-text question alone;
`classifyDayPlanRequest` screens only for injection, because a day plan has no
question - just a track name and two condition strings, which carry no motorsport
vocabulary and would be refused on every single request. `evaluateAdvicePolicy`
takes `allowEmptyRecommendations` for the same reason: the day-plan prompt tells
the model that recommending no change is a valid morning plan, so the default
"no recommendation is a non-answer" refusal would throw away a correct one.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
