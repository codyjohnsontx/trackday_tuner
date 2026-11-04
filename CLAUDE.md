# CLAUDE.md

## Project Overview

Mobile-first motorsport setup logger. Users log vehicle setups per track session (tires, suspension, etc.) and compare across sessions.

- `CONTEXT.md` - domain glossary (track, layout, direction, configuration); read before touching tracks
- `docs/adr/0001-what-a-track-is.md` - the owner's track definition and where the code does not match it yet

## Tech Stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5 strict
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
- **Firstmate agent lanes are the one exception** (owner, 2026-11-04). A Firstmate worker - an agent
  Firstmate launched into a disposable worktree - may chain the setup commands its launch brief
  gives it (`pwd -P`, `git rev-parse ...`, `git checkout -b ...`), and opens its PR ready for review
  or marks it ready (non-draft), because Firstmate's merge tooling refuses a draft. Nothing else
  here changes for it, and none of it changes for anyone else

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
  A Firstmate worker is the exception - see Git Protocol.
- Every entry in `path_filters` in `.coderabbit.yaml` must begin with `!`. An entry without one is an include, not an exclude, and a single include narrows the whole review to only what it matches, skipping everything else silently. Check this before editing that file.

1. `git status` — working tree must be clean. If not, stop and tell the user.
2. `ls .git/index.lock 2>/dev/null` — if lock exists, stop and tell the user. Do not delete it.
3. `gh pr list --head <branch>` — if a PR already exists, show it to the user and stop.
4. `git log --oneline main..HEAD` — show the user exactly which commits are going up. Wait for confirmation before continuing.
5. `git push -u origin HEAD` — wait for it to fully complete before proceeding. If it fails, report the error and stop.
6. `git branch -vv` — confirm the branch now shows a remote tracking ref. If not, stop.
7. `gh pr create --draft --title "<concise title>" --body "<summary + test plan>"` — write an explicit title and body. Do not use `--fill`. `--body` bypasses `.github/pull_request_template.md`, so a branch touching `lib/rag/`, `docs/knowledge-base/`, `data/rag-index.json` or the golden set has to carry that template's "RAG evaluation" section in the body by hand - the "Against baseline" block printed by `npm run rag:eval`.

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
npm run rag:eval     # RAG eval harness, offline replay (no API key needed)
npm run rag:eval -- --live             # re-record against the real API (key from .env.local or .env)
npm run rag:eval -- --update-baseline  # commit this run's scores as the baseline
npm run db:status    # which migrations are applied on the linked project
npm run db:new <name>  # scaffold a migration
npm run db:push      # apply pending migrations to the linked project
npm run db:audit     # regenerate the live-schema migration audit query
npm run db:drift -- <hosted.csv>  # diff a hosted schema inventory against the local stack
```

`next dev` writes to `.next/dev` and `next build` to `.next` (since Next 16), so
a build while a dev server is up no longer breaks it. On Next 15 they shared
`.next`: the build overwrote the dev chunk manifest, the running server 404ed on
`/_next/static/chunks/main-app.js`, pages still rendered but React never
hydrated, and every click silently did nothing - it looked exactly like a broken
component. A page behaving that way still gets `rm -rf .next` and a restart
before a component is blamed.

## Project Structure

```text
app/(app)/           # authenticated routes (layout enforces auth)
app/api/             # API routes (stripe checkout/portal/webhooks/AI, health, monitoring)
components/ui/       # shadcn/ui-backed component wrappers
components/layout/   # app shell, bottom nav
components/auth/     # auth form, set-password form
components/sessions/ # session form
components/garage/   # vehicle form
lib/actions/         # server actions (sessions, tracks, vehicles, sag)
lib/sessions/        # session create orchestration, client and rider passed in (no cookies, no Next)
lib/mobile/          # CORS for /api/mobile/* (the phone app's web build)
lib/monitoring/      # health checks, the ai_requests alert, reportError
lib/rag/             # RAG retrieval, prompt, policy, premise-guard, and validation helpers
lib/supabase/        # client, server, middleware, admin clients
lib/auth/            # OAuth providers, next-path sanitizing, auth error copy
lib/auth.ts          # getViewer(), isAuthenticated()
lib/utils.ts         # cn() utility (twMerge + clsx)
lib/billing.ts       # plan/tier helpers
lib/plans.ts         # plan definitions
docs/knowledge-base/ # curated markdown source files for RAG index
data/session-logs/   # sample session log JSON
```

## Design System

Use the tokens in `app/globals.css`, never raw palette classes (`zinc-*`, `cyan-*`, `amber-*`); `signal` is the only accent and `trackday-ui` holds the rest.
Every rule in `app/globals.css` sits inside `@layer base` or `@layer components`, because an unlayered rule outranks every Tailwind utility (`tests/unit/globals-css-layers.test.ts`).

## The Demo Is Read-Only

Every server action that writes starts with `assertNotDemoMode()` (`lib/demo/mode.ts`), and every
cookie-authenticated write route with `assertNotDemoRoute()`; `tests/unit/demo-read-only.test.ts`
fails on one that does not. `trackday-demo` has the rest.

## Testing

- `npm run test:unit` is vitest over `app/**`, `lib/**` and `tests/unit/**` with no DOM, so nothing
  in it is interactive; behaviour that only exists on screen belongs in `tests/e2e/`
- `npm run test:db` runs `tests/db/` against a local stack built from `supabase/migrations/` and is a
  CI gate; behaviour that lives in the database is proven there, not with a faked client
- `npm run test:e2e` is a CI gate on `iphone-safari` and `android-chrome` against a production build;
  `TESTING.md` owns the environment, and a new spec is watched failing before it passes
- A run with any failure, skip or error is not verified; report its pass/fail counts and the
  failing test names instead
- `trackday-testing` has the detail

## Project Skills

The detail behind every area below lives in a skill under `.agents/skills/`. Read its `SKILL.md`
before changing that area.

- `trackday-database` - migrations, RLS, grants, functions, storage buckets, hosted schema drift
- `trackday-ui` - components, design tokens, surfaces, type, cascade layers
- `trackday-demo` - the read-only demo and leaving it
- `trackday-data-access` - Supabase clients, session reads and ordering, read-before-write
- `trackday-session-domain` - rider answers, dates, device values, lap times, tracks
- `trackday-session-write` - the one session write path, web and mobile
- `trackday-service-book` - service books, transfers, shares, PDFs, attachments, reminders
- `trackday-testing` - what each test suite covers and gates
- `trackday-ai` - AI routes, prompts, screening, advice policy, rendering
- `trackday-rag-eval` - the RAG eval harness, tapes, baseline, model choice
- `trackday-monitoring` - reportError, health checks, schema contract, AI health

## Path Alias

`@/*` maps to project root.

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

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues (`codyjohnsontx/trackday_tuner`), through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, each equal to its role name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` (the glossary) and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
