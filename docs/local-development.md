# Local development

The full local setup, moved here from the README. The README has the short
version; this file covers the database, password-recovery mail, storage buckets
and linting in detail.

## Local Run

The app needs a database, and this repository builds one. Install first, then
start Docker: the local stack runs in containers, and `supabase start` silently
has nothing to do without it.

```bash
npm install
npx supabase start
```

That creates the database and applies every migration in `supabase/migrations/`
in order, on the ports declared in `supabase/config.toml` (API 54321, database
54322, Studio 54323). The CLI is a repo devDependency, which is why the bare
`supabase` in the `db:*` scripts resolves - npm puts `node_modules/.bin` on PATH
for scripts, but not for your own shell, so run it as `npx supabase` here. That
is also why `npm install` comes first: on a clean checkout there is no local copy
yet and `npx` would fetch an unpinned CLI from the registry instead of the
pinned one.
See "Building a database from nothing" in `CLAUDE.md` for which of those
migrations exist only to make a clean build work, and for the caveat that
applies to the hosted project.

Copy `.env.example` to `.env.local` and fill `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from
`npx supabase status -o env`. Those are local development values, not the hosted
project's.

Set `BETA_INVITE_ONLY=false` in the same file. `.env.example` ships it as `true`
and `isBetaInviteOnly()` in `lib/env.server.ts` reads unset as `true`, so leaving
it alone puts the invite-only wall in front of signup and no account can be
created. To exercise the invite flow instead, leave it `true`, set
`BETA_INVITE_SECRET`, and mint a code with
`npm run beta:invite -- create you@example.com`.

```bash
npm run dev
```

Then open `http://127.0.0.1:3000`. Email confirmation is disabled locally in
`supabase/config.toml`, so signing up logs you straight in.

Password recovery does send mail. The local stack captures it rather than
delivering it, so read the reset link in the mail viewer on
`http://127.0.0.1:54324` (`local_smtp` in `supabase/config.toml`). Request the
link with the app open on `http://127.0.0.1:3000`. That origin is required for
this one step: the app asks Supabase to return the rider to whichever origin the
browser is on, and `site_url` plus `additional_redirect_urls` in the same file are
the allow-list that return URL is checked against. A return URL that list does not
accept falls back to `site_url`. Measured against the local stack as shipped: a
link requested with the app on `http://127.0.0.1:3000` returns the rider to
`/reset-password` there, while one requested from `localhost` comes back to the
site URL instead.

Following the link does not reach the form on the first hop, and the detour is
`next dev` rather than the app. The callback signs the rider in and sets the
session cookie on `127.0.0.1`, then sends them to
`http://localhost:3000/reset-password`: under `next dev` the request URL a route
handler sees always reports `localhost`, whichever host the browser asked for, and
the redirect is built from it. No cookie was set on `localhost`, so that page
reads "Link expired". Put `127.0.0.1` back in the address bar and reload - the
session is already there, the form appears, and the new password saves. The
recovery code is spent by then and does not need to be used again.

What that builds is the database and the storage buckets, not everything the app
touches. `supabase start` (and `db reset`) seed the `vehicle-photos` and
`session-photos` buckets from their `[storage.buckets.*]` blocks in
`supabase/config.toml` and log `Creating Storage bucket: <name>` for each; the
policies that let a rider write their own folder are migrations like any other.
Before the `vehicle-photos` block existed a fresh database applied every migration
cleanly and answered the first photo with "Photo upload failed: Bucket not
found". The North American circuits a rider picks from are seeded by a migration,
so a fresh database has them too.

The buckets are the one thing `db push` does not carry to the hosted project, because
the CLI provisions buckets from `config.toml` rather than from migrations. A
deployment standing up its own project runs this once after `supabase link`, with
the same operator credentials `db push` needs:

```bash
npx supabase seed buckets --linked
```

It creates a bucket that is missing and brings an existing one's settings
(public, accepted MIME types, size limit) into line with `config.toml`. Run it
again whenever that block changes.

The garage card renders that photo through `next/image`, which serves only hosts
named in `images.remotePatterns`. `next.config.ts` derives that host from
`NEXT_PUBLIC_SUPABASE_URL` (`lib/supabase-storage-remote-patterns.ts`), so the
local stack is admitted as soon as `.env.local` points at it, next to
`*.supabase.co` for hosted projects. The value is read when the config loads:
after changing it, restart `npm run dev`. Before that rule existed the card threw
`hostname "127.0.0.1" is not configured under images` against a local stack while
the upload and the public URL were both correct.

To rebuild, `npx supabase db reset` re-applies every migration to the running
stack, and `npx supabase stop --no-backup` followed by `npx supabase start`
destroys the containers and volumes and rebuilds from nothing.

## Linting

This repo uses ESLint v9 with a flat config at `eslint.config.mjs` (via `@eslint/eslintrc` `FlatCompat` wrapping `eslint-config-next` presets).

```bash
npm run lint
```

Notes:

- `next lint` is intentionally not used here; the lint script runs the ESLint CLI directly.
- `next-env.d.ts` is ignored by ESLint because Next generates a triple-slash reference there that conflicts with `@typescript-eslint/triple-slash-reference`.
