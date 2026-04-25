# CLAUDE.md

## Project Overview

Mobile-first motorsport setup logger. Users log vehicle setups per track session (tires, suspension, etc.) and compare across sessions.

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 19, TypeScript 5 strict
- **Styling**: Tailwind CSS v4, dark theme only (zinc-950 bg, cyan-400 accent)
- **UI**: shadcn/ui pattern — `cva` + `cn()` from `lib/utils.ts`, Radix primitives
- **Backend/Auth**: Supabase (email/password)
- **Payments**: Stripe (subscriptions)
- **AI**: OpenAI (planned RAG query tool, not active in current routes)
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

- Treat files or directories with Finder-style duplicate names such as `* 2.ts`, `* 2.tsx`, `* 2.mjs`, `* 2.sql`, `* 2.json`, or folders ending in ` 2` as accidental artifacts unless the user explicitly asked for them
- Do not create duplicate working copies in the repo as a drafting workflow
- If duplicate artifacts are found, stop and tell the user before proceeding with git operations
- Remove accidental duplicates before creating a PR so they do not remain as untracked clutter across branch switches

### Creating a PR (exact steps, no deviation)

1. `git status` — working tree must be clean. If not, stop and tell the user.
2. `ls .git/index.lock 2>/dev/null` — if lock exists, stop and tell the user. Do not delete it.
3. `gh pr list --head <branch>` — if a PR already exists, show it to the user and stop.
4. `git log --oneline main..HEAD` — show the user exactly which commits are going up. Wait for confirmation before continuing.
5. `git push -u origin HEAD` — wait for it to fully complete before proceeding. If it fails, report the error and stop.
6. `git branch -vv` — confirm the branch now shows a remote tracking ref. If not, stop.
7. `gh pr create --title "<concise title>" --body "<summary + test plan>"` — write an explicit title and body. Do not use `--fill`.

**Never** run extra staging, committing, stashing, or branch operations unless explicitly asked. If the push is slow, wait — do not retry or run a second push in parallel.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run test:unit    # vitest unit tests
npm run test:e2e     # playwright e2e tests
npm run lint         # eslint
npx tsc --noEmit     # type check (run after build so .next/types exist)
npm run rag:index    # build RAG index from docs/knowledge-base/
```

## Project Structure

```
app/(app)/           # authenticated routes (layout enforces auth)
app/api/             # API routes (stripe checkout/portal/webhooks)
components/ui/       # shadcn/ui-backed component wrappers
components/layout/   # app shell, bottom nav
components/auth/     # auth form
components/sessions/ # session form
components/garage/   # vehicle form
lib/actions/         # server actions (sessions, tracks, vehicles, sag)
# lib/rag/           # planned RAG pipeline (not currently present)
lib/supabase/        # client, server, middleware, admin clients
lib/auth/            # getAuthenticatedUser(), isAuthenticated()
lib/utils.ts         # cn() utility (twMerge + clsx)
lib/billing.ts       # plan/tier helpers
lib/plans.ts         # plan definitions
# docs/knowledge-base/ # planned markdown source files for future RAG index
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
- Cyan-400 (`#22d3ee`) focus rings: `focus-visible:ring-2 focus-visible:ring-cyan-400/80`
- `rounded-xl` on inputs/buttons, `rounded-2xl` on cards
- Zinc palette: `zinc-950` bg, `zinc-900` surfaces, `zinc-100` text, `zinc-400` muted

## CSS Variables

shadcn CSS vars live in `@layer base { :root { ... } }` in `app/globals.css`.
Tailwind v4 project tokens live in `@theme { ... }` — these are separate namespaces, no collision.

## Path Alias

`@/*` maps to project root.

## Supabase Notes

- Use `lib/supabase/server.ts` in Server Components and Route Handlers
- Use `lib/supabase/client.ts` in Client Components
- `lib/supabase/middleware.ts` handles session refresh — runs via `middleware.ts`
- Admin client (`lib/supabase/admin.ts`) uses service role key — server only

## Current AI Status

RAG routes and `lib/rag` implementation are planned but not active in this checkout.
