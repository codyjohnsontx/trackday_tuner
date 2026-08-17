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

## Current AI Status

AI routes are active for tuning advice, recommendation feedback, and day planning.
`lib/rag/` contains retrieval, prompt, policy, validation, and schema helpers.
Knowledge-base markdown lives in `docs/knowledge-base/` and can be indexed with `npm run rag:index`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
