---
name: trackday-demo
description: "Use when changing trackday_tuner public demo behavior, demo write protection, or demo exit routing."
---

## The Demo Is Read-Only

Owner decision, 2026-10-04: the public demo is a tour of sample data, never a
sandbox. Every server action that writes starts with `assertNotDemoMode()` and
every cookie-authenticated write route with `assertNotDemoRoute()`
(`lib/demo/mode.ts`), and a screen in demo offers no save at all rather than a
button that refuses after the click. `tests/unit/demo-read-only.test.ts` finds
every `'use server'` module and every mutating route handler on disk and fails on
one that writes in demo; a write route that is genuinely not the demo's (Stripe's
webhook, bearer-authenticated mobile) goes on its `NOT_DEMO_SCOPED` list with the
reason. A server action is treated as a read only when its name starts with
`get` or `has`.

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
`components/demo/demo-banner.tsx` does. No spec guards that: locally the e2e
suite runs `next dev`, which does not prefetch on viewport, and no spec CI runs
against its production build watches for it, so it was checked by building with
and without the flag and watching the cookie survive or vanish on render.

