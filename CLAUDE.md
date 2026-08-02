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

- PRs are ready for review by default. Create a draft PR only when the user explicitly asks for a draft.

1. `git status` — working tree must be clean. If not, stop and tell the user.
2. `ls .git/index.lock 2>/dev/null` — if lock exists, stop and tell the user. Do not delete it.
3. `gh pr list --head <branch>` — if a PR already exists, show it to the user and stop.
4. `git log --oneline main..HEAD` — show the user exactly which commits are going up. Wait for confirmation before continuing.
5. `git push -u origin HEAD` — wait for it to fully complete before proceeding. If it fails, report the error and stop.
6. `git branch -vv` — confirm the branch now shows a remote tracking ref. If not, stop.
7. `gh pr create --title "<concise title>" --body "<summary + test plan>"` — write an explicit title and body. Do not use `--fill`.

**Never** run extra staging, committing, stashing, or branch operations unless explicitly asked. If the push is slow, wait — do not retry or run a second push in parallel.

### How PRs land

- PRs merge with a **merge commit** — `gh pr merge <n> --merge`. The merge commit takes the PR title as its message with a blank body. Squash merging is disabled on the repository; rebase merging is allowed but is not the default
- Every commit on the branch lands on `main`, so each one must stand on its own. No `wip`, no `fix typo`, no commits that only make sense next to the one after them
- Review-response work is a normal commit describing what changed and why, not an amendment to the original
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
  `db push` will never re-run it. Corrections go in a new migration
- Filenames are `<14-digit timestamp>_<name>.sql`. The timestamp is the version
  recorded remotely and is a primary key, so **two migrations must never share a
  prefix** — an earlier pair both named `20260224_` could not both be recorded
- `create table`, `create index`, and `create function` statements are written
  idempotently (`if not exists` / `or replace`). `create policy` is not, so a
  half-applied migration cannot simply be replayed — check `db:status` first
- Applying requires `supabase login` and `supabase link`, which need a personal
  access token and the database password. Those are interactive and belong to
  the operator, not to CI or an agent

## Project Structure

```text
app/(app)/           # authenticated routes (layout enforces auth)
app/api/             # API routes (stripe checkout/portal/webhooks/AI)
components/ui/       # shadcn/ui-backed component wrappers
components/layout/   # app shell, bottom nav
components/auth/     # auth form
components/sessions/ # session form
components/garage/   # vehicle form
lib/actions/         # server actions (sessions, tracks, vehicles, sag)
lib/rag/             # RAG retrieval, prompt, policy, and validation helpers
lib/supabase/        # client, server, middleware, admin clients
lib/auth/            # getAuthenticatedUser(), isAuthenticated()
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

shadcn CSS vars live in `@layer base { :root { ... } }` in `app/globals.css`.
Tailwind v4 project tokens live in `@theme { ... }` — these are separate namespaces, no collision.

## Cascade Layers

**Every rule in `app/globals.css` must sit inside a layer**: `@layer base` for
element defaults, `@layer components` for helper classes. Tailwind v4 emits all
utilities inside `@layer utilities`, and unlayered CSS beats layered CSS at any
specificity, so one unlayered rule silently disables a whole family of utilities
with no warning from the build, the linter, or the types. An unlayered
`a { color: inherit }` outranked `text-canvas` on every link in the app, so the
primary CTA rendered as white text on a white pill (contrast 1.00:1) on every
list screen. `font: inherit` and `min-height` on the same block were doing the
same to `text-*`, `font-*`, and `min-h-*` on form controls. Verify a change here
in the browser: `getComputedStyle` on an `<a class="text-canvas">` must match the
same class on a `<span>`.

## Path Alias

`@/*` maps to project root.

## Supabase Notes

- Use `lib/supabase/server.ts` in Server Components and Route Handlers
- Use `lib/supabase/client.ts` in Client Components
- `lib/supabase/middleware.ts` handles session refresh — runs via `middleware.ts`
- Admin client (`lib/supabase/admin.ts`) uses service role key — server only

## Current AI Status

AI routes are active for tuning advice, recommendation feedback, and day planning.
`lib/rag/` contains retrieval, prompt, policy, validation, and schema helpers.
Knowledge-base markdown lives in `docs/knowledge-base/` and can be indexed with `npm run rag:index`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
