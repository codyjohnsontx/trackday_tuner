# Testing

## Stack
- Unit tests: Vitest
- E2E tests: Playwright (cross-device profiles)

## Support Matrix
- Primary (merge-blocking): iPhone Safari, Android Chrome
- Secondary (release candidate): iPad Safari, Desktop Chrome/Safari/Edge

## Environment
Playwright loads the same local env files as the app via Next's env loader. Use `.env.local` for normal local runs, or override values in your shell when you need a different test target.

Create `.env.test`-style shell overrides (or export vars in your shell) when needed:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000
E2E_EMAIL=your_test_user_email
E2E_PASSWORD=your_test_user_password
PW_SKIP_WEBSERVER=0
NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true
NEXT_PUBLIC_AUTH_APPLE_ENABLED=false
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_MONTHLY_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE=FOUNDER100
```

`E2E_EMAIL` and `E2E_PASSWORD` are required only for authenticated smoke tests.
Unauthenticated guard tests run without them.
Specs that assert what was persisted, or that seed and clean up their own rows,
also need `SUPABASE_SERVICE_ROLE_KEY` alongside the app's
`NEXT_PUBLIC_SUPABASE_URL`. They reach the database through
`tests/e2e/helpers/supabase.ts` rather than trusting what the screen shows, and
each skips itself with a message naming what it needed the key for, so that
import is the list.
All six device projects sign in as that one account, so any row a spec creates
has to carry a per-run identifier. A fixed track name or sag label lets one
project's cleanup delete a row another project is still using, and
`sessions.track_id` is `ON DELETE SET NULL`, so that rewrites the other run's
data instead of failing it. The identifier has to carry the Playwright *project*
as well as the worker: `workerIndex` repeats across the six device projects, so
two of them can otherwise agree on one. Build it with `runResourceId(testInfo)`
from `tests/e2e/helpers/run-id.ts`, and scope the spec's cleanup to it.
That account also has to be on the **Pro** tier. These specs create a vehicle, a
custom track and sessions per run across parallel device projects, and every
free-plan cap in `lib/plans.ts` sits below what six projects need at once. Each
one fails a spec for a reason that has nothing to do with what is under test: at
the vehicle and session caps `/garage/new` and `/sessions/new` serve
`PlanLimitNotice` instead of the form, so the spec times out looking for a field
that was never rendered, and at the track cap resolution falls back to a
name-only session, so the `track_id` and track-row assertions fail.
`tests/e2e/signup-creates-profile.spec.ts` and
`tests/e2e/vehicle-photo-upload.spec.ts` stand outside both of those, because each
signs up its own throwaway rider rather than using that account. Both need
`NEXT_PUBLIC_SUPABASE_ANON_KEY` as well as the service-role key - the first reads
the new rider's `profiles` row back under their own session, the second uploads
as the rider and as nobody - and both need `BETA_INVITE_ONLY=false`, because with
invite-only on the form posts to `/api/beta/signup` rather than signing up through
GoTrue. Each skips without any of them. For the signup spec that last gate is the
point: `/api/beta/signup` is the `profiles` writer that always worked, so the spec
would exercise the wrong path entirely instead of the GoTrue signup whose trigger
it exists to guard. For the photo spec it is only how a throwaway rider is made;
the bucket it guards is the same either way, and a rider with no vehicles is what
keeps the free-plan vehicle cap out of the result. That spec also needs the stack
to have been built with the `[storage.buckets.vehicle-photos]` block in
`supabase/config.toml` - `supabase start` or `db reset` since it was added - which
is exactly what it exists to prove.
`tests/e2e/profile-entitlement-columns.spec.ts` also makes its own throwaway
rider, through the admin API rather than the form, so it needs the anon and
service-role keys and nothing else: no `BETA_INVITE_ONLY`, no signed-in account,
and no dev server, because it never opens a page - it sends the Data API the
request a rider would use to set their own `tier` and asserts the refusal. That
is what makes it runnable against any stack, including the hosted project after
the grants block in `docs/beta-runbook.md` has been applied there. Playwright
still starts `next dev` for it unless `PW_SKIP_WEBSERVER=1` is set, which is why
the runbook's command sets it.
`tests/e2e/plan-limit-gate.spec.ts` makes one too, for the opposite reason to all
of them: what it tests is a rider the free-plan caps can reach, which the Pro
account never is. That rider is created through the admin API and seeded to the
session limit, so the spec needs the service-role key and a running app, but no
anon key and no `BETA_INVITE_ONLY`. Its second half is a different subject - that
a tap at the middle of "Save Session" reaches the button rather than the floating
nav - and drives the shared account like everything else, so that half also skips
without `E2E_EMAIL` and `E2E_PASSWORD`.
`tests/e2e/session-laps-stale-read-guard.spec.ts` makes one through the admin API
as well. `replace_session_laps` is `security invoker` and checks `auth.uid()`, so
its calls have to carry a real session, and the laps it plants must not land in
the shared account other specs read. It needs the service-role key and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, no `E2E_EMAIL`, `E2E_PASSWORD` or
`BETA_INVITE_ONLY`, and a running app only for its last test - the one thing here
a browser has to settle, that clearing every lap in the editor asks first. It is
also the one spec that needs a particular migration applied: the guard its other
ten tests assert is `20260903001500`, so a stack rebuilt without it fails the
spec rather than skipping it - on `20260901001400` alone the calls naming
`p_expected_laps` get `PGRST202` instead. Two of those ten are the equal-count
saves a count comparison lets through, and they were watched failing against one
wearing this same signature.
Set `PW_SKIP_WEBSERVER=1` if you already have the app running and want Playwright to reuse it.

`next dev` rebuilds `request.url` with `localhost` whatever `Host` arrived, so a
redirect out of a route handler lands on a different origin - and a different
cookie scope - than the `127.0.0.1` the suite drives, and the browser arrives
without the cookies that redirect just set. README's "Local Run" describes the
same hop from the operator's side, walking a recovery link by hand. A spec that
follows one has to re-enter on the base origin before it can see them again, and
should assert on the path rather than the whole URL;
`tests/e2e/demo-reset-password.spec.ts` has the shape. A deployed build uses the
forwarded host and does not hop, so this is local-only.

## Install browser runtime
```bash
npx playwright install
```

## Run tests
```bash
npm run test:unit
npm run test:e2e
```

By default, `npm run test:e2e` skips in CI unless explicitly enabled.
- Force E2E in CI: `RUN_E2E=1 npm run test:e2e`
- Skip E2E anywhere: `SKIP_E2E=1 npm run test:e2e`

Watch mode for units:
```bash
npm run test:unit:watch
```

Interactive Playwright UI:
```bash
npm run test:e2e:ui
```

Run a specific device profile:
```bash
npx playwright test --project=iphone-safari
npx playwright test --project=android-chrome
npx playwright test --project=ipad-safari
```

## Auth redirect setup checklist (Supabase)

`/auth/callback` is not OAuth-only. Password recovery links land there too,
carrying `?next=/reset-password`, so this checklist applies even when every OAuth
provider is disabled - without it a rider clicking a reset link is sent back to
the site URL instead of the reset form.

- Add redirect URLs:
  - `http://127.0.0.1:3000/auth/callback`
  - `http://localhost:3000/auth/callback`
  - `https://<your-vercel-domain>/auth/callback`
- Set `Site URL` per environment so Supabase redirects correctly.

For OAuth specifically:
- Enable Google and Apple providers in `Supabase Dashboard -> Auth -> Providers`.
- Configure each provider's client credentials in Supabase.

## Stripe billing setup checklist
- Create one recurring monthly Pro price in Stripe at `$2.99` and set `STRIPE_PRO_MONTHLY_PRICE_ID`.
- Create a Stripe coupon for founders:
  - Amount off: `$1.00`
  - Duration: `forever`
- Create a promotion code linked to that coupon:
  - Code: `FOUNDER100` (or your custom code)
  - Max redemptions: `100`
- Set `NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE` to match your public code.
- Set server env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
- Ensure `NEXT_PUBLIC_APP_URL` matches your active local/web environment.
- Start webhook forwarding locally:
```bash
stripe listen --forward-to http://127.0.0.1:3000/api/stripe/webhook
```
- Copy the printed webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
- Trigger sample events:
```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

Founder promo verification:
- Open Checkout and apply `FOUNDER100`; total should reflect `$1.99/mo`.
- Remove promo code; base pricing should show `$2.99/mo`.
- After 100 redemptions, Stripe should reject the code and keep base price active.

## Cross-Device Release Checklist
- Touch targets for primary actions are `>= 44px`.
- No horizontal overflow at: `360x800`, `390x844`, `768x1024`, `1366x768`.
- Bottom nav and sticky actions remain visible and tappable on phones.
- Form input modes are correct (email/numeric/time/date where applicable).
- Inline validation messages are visible without layout breakage.
- Primary matrix smoke tests pass:
  - `npx playwright test --project=iphone-safari`
  - `npx playwright test --project=android-chrome`
- Secondary matrix smoke sweep passes before release candidate:
  - `npx playwright test --project=ipad-safari`
  - `npx playwright test --project=desktop-chrome`
  - `npx playwright test --project=desktop-safari`
  - `npx playwright test --project=desktop-edge`
- Manual real-device quick pass (5-10 min):
  - iPhone Safari
  - Android Chrome
