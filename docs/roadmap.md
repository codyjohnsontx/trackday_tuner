# Trackday Tuner Roadmap

Trackday Tuner is building one tight learning loop for track-day riders: capture a
session, compare it with relevant history, record whether the result improved, and
use that evidence to make the next recommendation safer and more specific.

## Launch Focus

The founding beta is positioned for intermediate and advanced motorcycle
track-day riders who adjust tires or suspension and expect to attend at least two
track days in a 90-day period. Cars remain supported by the product and the public
waitlist accepts every motorsport segment, but motorcycle riders are the first
acquisition and validation cohort.

The product promise is:

> Know what changed, whether it helped, and what to try next.

## Operating Model

Roadmap work ships one item per PR. Each item should be reviewed, merged, and
learned from before the next item starts. PRs stay focused on the active item and
do not pull later roadmap scope forward.

Work queue items are the exception. Most are defects in already-shipped features
rather than new scope, so they may ship out of band and in the same PR when they
share a root cause.

## Work Queue

Found in a codebase and running-app audit on 2026-07-25. Ranked highest impact
first. Two rules set position: work that unblocks other work outranks work that
does not, and harm landing on someone today outranks harm that lands later.

The `R` and `F` ids are stable handles and stay attached to an item when its
position changes, so reprioritizing never invalidates a reference. Numbering in
this section is independent of the ordered roadmap below.

Position is impact order, not a schedule. Items 1 to 4 are live defects and should
be worked in that order. Items 5 to 9 unblock or protect everything after them.
Items 10 to 17 are real but survivable. Item 5 is the one place where impact order
and execution order may legitimately diverge; the reason is recorded there.

### 1 to 4 - live defects

1. **Unauthenticated Stripe checkout through demo mode** - `R1` - **Reproduced and
   fixed in the repo on 2026-07-27; production stays exposed until it deploys.**
   `GET /demo` is public and sets a cookie that makes `getAuthenticatedUser()` return a synthetic
   `demo-user`, which `DEMO_PROFILE` marks as `tier: 'pro'`. A `POST` to
   `/api/stripe/checkout` carrying only that cookie returns a real Checkout Session
   URL and creates a real Stripe Customer. The follow-up profile write fails on the
   uuid cast and is unchecked, so if a session is ever completed the webhook matches
   no profile, returns 200, and the payment grants nothing. The route is also
   unrate-limited, so Customer objects can be created in bulk. First because it is
   the only item where a rider can lose money and an outsider can act on the live
   Stripe account. Gate the write routes today; the durable fix is `R2`.

   Reproduced against a running dev server: `GET /demo` with no credentials, then
   `POST /api/stripe/checkout` carrying only that cookie, returned a real Checkout
   Session URL. `assertNotDemoRoute()` now refuses demo requests with a 403 before
   any handler acts on the synthetic user, applied to checkout, portal, events, the
   session outcome route, and both AI routes. `beta/*` stays public by design and
   the Stripe webhook is signature-verified rather than cookie-based, so neither is
   gated. The swallowed `profiles` write is now verified by the row the update
   returns rather than by the absence of an error, because a missing row or an RLS
   denial updates nothing and reports no error, and a checkout that proceeds without
   a linked customer id takes a payment the webhook can never match. The unlinked
   Stripe customer is deleted on that path so failed attempts cannot pile up.

   Remaining: checkout is still unrate-limited for authenticated riders. A
   demo-cookie request is now refused with a 403 before authentication runs, and a
   request carrying neither a demo cookie nor a real session gets a 401, so the
   remaining exposure is a signed-in rider hammering the route. Enforcing the demo
   distinction at each call site through the type system is `R2`.

2. **Demo identity is indistinguishable from a real session** - `R2` - **Fixed in
   the repo on 2026-07-28.** All fourteen
   route handlers were audited at the time of the audit and none checked demo mode,
   while server actions consistently call `assertNotDemoMode()`. `R1` has since
   added `assertNotDemoRoute()` to the six write routes, which closes the live
   exposure but leaves the safeguard as a convention a reviewer has to remember
   rather than a rule the compiler enforces. Handing route handlers a fake user
   object keeps the distinction invisible to every downstream caller, so each new
   route still inherits the bug. Change `getAuthenticatedUser()` to return a
   discriminated result so the type system forces the decision at each call site.
   Second because `R1` returns the next time a route is added until this lands, and
   `R6` cannot be fixed cleanly without it.

   The audit assumed one function returning a union, but the 46 call sites were
   checked first. 36 are server actions sitting behind an existing `isDemoMode()`
   or `assertNotDemoMode()` branch and 6 are the route handlers `R1` guarded, so in
   those 42 the demo user was already unreachable. The synthesis existed for two
   page-level callers while endangering the rest. `getAuthenticatedUser()` is
   therefore gone, replaced by `getRealUser()`, which cannot return a demo user, and
   `getViewer()`, which returns the `Viewer` union and is the only way to obtain a
   demo identity. Deleting the old name is what forces the choice: reaching for "the
   user" in a new route now lands on a function that cannot hand back a fake one.

   Those 42 became a rename with identical semantics, and the two page-level
   callers handle the union. The remaining 2 changed behaviour, and they are the
   point: the write routes `R1` had missed by enumeration, `/api/beta/feedback`
   and `/api/sessions/export`, stopped serving a demo user without either being
   named. That is the demonstration of why the type change outranks the guards.
   `beta/feedback` has since been given an `assertNotDemoRoute()` guard too,
   so it refuses with the read-only message rather than a misleading 401.

   Demo mode also takes precedence over a live session inside `getRealUser()`.
   Entering the demo does not sign a rider out, so a signed-in rider carries both
   cookies; without that precedence the app would render demo data while an ungated
   read such as `/api/sessions/export` returned their real account. A browser in
   demo has no real user for as long as it stays there.

   `isAuthenticated()` is now false in demo mode, which is what it always claimed to
   mean. Its only caller, `app/layout.tsx`, already wrote `demoMode || await
   isAuthenticated()`, so behaviour is unchanged.

   Note for `R6`: demo requests to `/api/sessions/export` now return 401 rather than
   the previous 500. The route is still unusable in the demo, which is what `R6`
   fixes; it simply fails honestly now.

3. **RAG index is absent from deployments** - `R3` - **Confirmed and fixed in the
   repo on 2026-07-26; production stays broken until the fix is deployed.**
   `data/rag-index.json` was gitignored and had never been committed on any branch,
   so it could not exist in a Vercel deployment, and the retriever reads it from
   disk at request time with no fallback. Every Race Engineer call in production
   returned 500. The `ai_requests` rows that looked healthy were all local dev from
   20 to 25 April, the week the feature was built; there has been no AI traffic
   since. This corrupted the gate directly, because `summarizeAiGuidance` counts a
   rider as guided only on a success status, so the outage read identically to
   riders declining to use the AI.

   The fix commits the index, pulls it into the serverless bundle with
   `outputFileTracingIncludes` (the retriever's `process.cwd()` path is invisible to
   output file tracing, so committing alone was not sufficient), and gates the build
   on `npm run rag:check`, which fails on a missing, zero-vector, malformed, or
   stale index. Staleness is caught by a `source_hash` over the knowledge base
   stored in the index. Failing the build beats failing at startup: a broken index
   can no longer reach a deployment. Two contributing causes were also closed —
   `build-rag-index.mjs` never loaded `.env.local`, so a rebuild without an exported
   key silently produced a zero-vector index, and the index is now written compact
   with embeddings rounded to six decimals, which cuts it from 3.14 MB to 1.07 MB
   with no effect on cosine ranking.

   Remaining: deploy, then confirm a real Race Engineer call logs an `ok` status.

4. **Core schema is not in version control** - `R4` - **Fixed in the repo on
   2026-08-03.** `supabase/migrations/` began at `20260224` and contained only
   additive changes. Nothing created `profiles`, `vehicles`, `tracks`, or
   `sessions`. No fresh environment could be stood up from the repo, which blocked
   staging, disaster recovery, and any e2e run against a clean database, and left
   the RLS policies on the four tables holding all rider data unversioned and
   unreviewable. Fourth because it is the widest roadblock in the list and the only
   item where a bad day means the data model cannot be rebuilt.

   `20260223000000_init_baseline_schema.sql` now creates those four tables and their
   policies, dated before the rest of the history so the migrations the hosted
   project has already recorded stay untouched. It was reconstructed from
   `types/supabase.ts` and from what the later migrations alter and reference,
   rather than captured with `supabase db pull`, which needs a linked hosted
   project. A second failure sat underneath it: nothing in the repo granted `anon`,
   `authenticated` or `service_role` anything, so a fresh project applied every
   migration cleanly and then answered every PostgREST request with
   `permission denied for table ...`. `20260719001100_grant_data_api_access.sql`
   closes that, and `tests/unit/migrations-bootstrap.test.ts` guards both. The
   mechanics and the hosted-project caveat are in CLAUDE.md under "Building a
   database from nothing".

   Remaining: the hosted project has not recorded the out-of-order baseline yet.

<!-- The band headings and the paragraph above name items by absolute position,
     so these lists continue the numbering across headings rather than each
     restarting at 1. Scoped to these two sections only. -->
<!-- markdownlint-disable MD029 -->

### 5 to 9 - unblock and protect

5. **Structured numeric setup values** - `F1` - every setup field is typed `string`
   (`34 psi hot`, `12 clicks`) and change detection is `current !== baseline`, so
   `34` and `34 psi` read as a change and no delta can ever be computed. The Changes
   panel can only restate both strings, the AI must infer magnitude from prose, and
   charting or trending is impossible. Lap times already do this correctly with
   `lap_time_ms`. The fix is a parsed `{value, unit}` shape with the raw string
   retained for display and backfill. Ranked fifth because it blocks ordered roadmap
   items 11, 12, and 13 plus the PRD's analytics, weakens the "know what changed"
   half of the product promise today, and grows more expensive with every session
   logged. It is also the one item whose rank and schedule may diverge: validation
   mode argues for deciding it at the ordered roadmap item 8 review rather than
   starting it now. The rank records the cost of waiting; the operating model
   decides whether to pay it.

6. **`npm run lint` is unusable locally** - `R9` - `eslint.config.mjs` does not
   ignore `.claude/`, so the command lints agent worktrees and reports 10,585
   problems. Scoped to real source it is clean, and CI passes because it checks out
   fresh. Ranked above larger items because two lines of `ignores` restore a check
   that every item below this one depends on, and because it currently costs a
   developer something on every single change.

7. **No error boundaries** - `R5` - there is no `error.tsx`, `not-found.tsx`, or
   `global-error.tsx` anywhere under `app/`. Any thrown server-component error
   renders the unstyled Next.js error page with no retry. The product is used on
   marginal trackside LTE, so this is the common path, not the rare one, and it is
   the safety net under every deploy that follows.

8. **Race Engineer, export, and analytics are unreachable in the demo** - `R6` -
   demo entities use string ids, so `/api/ai/tuning-advice` rejects them with a UUID
   validation error, and `/api/sessions/export` and `/api/events` both return 500.
   The demo therefore cannot show the AI assistant, CSV export, or analytics, which
   is the entire Pro proposition. This does not distort the beta report, which
   filters events to registered rider ids, but the public demo cannot sell the
   feature the gate is meant to validate. Also unblocks `F2`.

9. **Core loop is only partly covered end to end** - `F2` - `auth-and-sag.spec.ts`
   and `ai-tuning-advice.spec.ts` cover auth redirects, the sag calculator, the
   converter, tracks, and AI rejection paths, and `signup-creates-profile.spec.ts`
   covers the signup trigger rather than the loop.
   `tests/e2e/same-day-session-compare.spec.ts` adds a vehicle, logs two
   same-day sessions, and asserts both the rendered comparison and the persisted
   `session_changes` row, so add vehicle, log session, and compare are covered.
   Recording an outcome joined them on 2026-08-17 in
   `tests/e2e/session-answers.spec.ts`, alongside new specs for pasted lap times,
   the track row a typed name creates, the local date the form prefills, the
   temperature unit, and the sag history and its mid-delete selection race.
   Those specs drive the real E2E account and skip without its credentials (see
   `TESTING.md`), and E2E is still skipped in CI by default. Demo mode is a
   deterministic fixture that needs no Supabase and no secrets, and no test uses
   it, so the remaining coverage is cheap once `R6` lands.

### 10 to 17 - real but survivable

10. **Body text below AA contrast** - `R8` - `text-zinc-500` measures 4.12:1 on
    `zinc-950` and 3.67:1 on `zinc-900` cards against a 4.5:1 threshold, across 96
    usages, mostly small uppercase section labels. `text-zinc-600` measures 2.57:1.
    `zinc-400` is 7.76:1, so this is a token swap. Highest of the survivable group
    because it degrades every screen for the sunlight case the product is built for.

11. **Duplicate DOM ids on `/sag`** - `R7` - **Fixed in the repo on 2026-08-19.**
    `Input` derived its `id` from the label text, so the front and rear sag sections
    emitted `fully_extended_(l0)`, `bike_only_(l1)`, and `rider_on_bike_(l2)` twice
    each. A `for` resolves to the first match in the document, so tapping a rear
    label focused the front input, and the three rear fields reached assistive tech
    with no accessible name at all, announced as their `mm` placeholder.

    The id now comes from `useId()`, which is unique per instance; an explicitly
    supplied `id` still wins and no caller passes one, so no old value was
    load-bearing. The hook makes `Input` a client component, and every consumer
    already sat inside a client boundary. The label text also moved out of the
    wrapper it shared with the error and helper paragraphs into its own
    `<label htmlFor>`, so those two describe the field through `aria-describedby`
    rather than being read as part of its name.
    `tests/unit/input-label-association.test.ts` guards the distinct ids and the
    label/input association, and `tests/e2e/auth-and-sag.spec.ts` now reaches the
    rear section - a failure there is a defect again rather than the expected
    result.

12. **Nothing is statically rendered** - `F3` - the root layout awaits
    `isDemoMode()`, which reads cookies and opts the whole tree out of static
    generation. The build marks every route dynamic, including `/`, `/privacy`, and
    `/terms`. The landing page sits at the top of the beta funnel and cannot be
    CDN-cached. Move the cookie read below the layouts that need it.

13. **Navigation reach regression** - `F6` - **Premise resolved; verified on
    2026-08-02.** `components/layout/bottom-nav.tsx` is live rather than dead code:
    `components/layout/app-shell.tsx` imports it and renders it whenever a rider is
    authenticated or in demo mode, restored in `f8a5c05` on 2026-07-29. Navigation
    is not hamburger-only, `CLAUDE.md` and the code agree, and there is nothing left
    to correct on either side.

14. **Free-tier limits duplicated** - `F5` - `lib/plans.ts` is authoritative, but the
    sessions and dashboard pages inline `10` in four places. Changing a plan silently
    desyncs the displayed limit from the enforced one.

15. **Unbounded session queries** - `F4` - `/sessions` fetches every session with no
    limit, then every matching environment row, then derives analytics across the
    whole set. There is no pagination anywhere. Comfortable at ten sessions; a rider
    at six to eight sessions across fifteen days reaches several hundred in a season,
    and Pro promises unlimited. Last of the functional items because it is the only
    one whose pain is entirely in the future.

16. **Dead and stale artifacts** - `F7` - `components/demo/demo-aware-link.tsx` is
    untracked and unreferenced, thirteen local branches and two agent worktrees
    remain, and `body { min-height: 100vh }` should be `100dvh` for iOS Safari.
    This entry also listed `components/layout/bottom-nav.tsx` as dead; that was
    struck on 2026-08-02 because the component is live and rendered. See item 13.

17. **Raw form controls below the iOS 16px zoom floor** - `F8` - an accepted trade,
    not an open defect. Putting `app/globals.css` inside cascade layers let the
    authored `text-sm` on those controls finally apply; the previous 16px was an
    unlayered `input, select, textarea, button { font: inherit }` outranking that
    utility, so the app now renders what its own source says. The cost is that 32
    raw controls across nine files (`components/ai/day-plan-panel.tsx`,
    `components/beta/beta-survey.tsx`, `components/beta/waitlist-form.tsx`,
    `components/sessions/lap-time-editor.tsx`,
    `components/sessions/session-compare-picker.tsx`,
    `components/sessions/session-export-panel.tsx`,
    `components/sessions/session-form.tsx`,
    `components/sessions/session-outcome-panel.tsx`,
    `components/tools/unit-converter.tsx`) now
    sit below 16px, where iOS Safari zooms the viewport on focus. Correcting it means
    restyling those call sites, which the cascade-layer brief ruled out, and several
    live in session-comparison files another worker holds. Raise them to `text-base`
    if picked up, deciding deliberately whether 16px is the right floor for form
    controls generally.

<!-- markdownlint-enable MD029 -->

## Ordered Roadmap

1. Session comparison v1 - Complete; structured performance capture is item 5
2. Baseline setup per vehicle - Complete
3. Change tracking - Complete
4. Recommendation outcome loop - Built; pending live validation
5. Structured manual lap capture - Built; pending live validation
6. Founding beta access and acquisition - Built; pending live validation
7. Beta measurement and validation - Built; pending live validation
8. **Evidence-based next roadmap decision** - Active after the beta gate
9. AI day-plan guardrails
10. Vehicle- and track-specific memory improvements
11. CSV and lap-timer import
12. Tire lifecycle tracking
13. Setup templates
14. Coach/share mode
15. Event mode

Items 11, 12, and 13 all read setup values numerically and are blocked on `F1`,
work queue item 5. Deciding `F1` belongs in the item 8 review rather than at the
start of item 11, because the migration cost rises with every session logged in
the meantime.

## Current Product Loop

Recommendation Outcome Loop records how a later session compared with a prior
reference session and optionally links the AI recommendation tested between them.
The outcome belongs to the later session, remains editable, appears in vehicle
history, and becomes grounded evidence for future Race Engineer guidance.

The implemented slice includes outcome capture, recommendation linking, history
visibility, idempotent memory updates, tier access, and automated coverage. It does
not include imports, tire lifecycle, templates, team workflows, or event mode.

The product is now in validation mode. New roadmap scope should respond to
observed rider behavior and interviews rather than expand the feature surface.

## Founding Beta Gate

Review the beta when either twelve riders have registered and eight have logged
sessions on two distinct track dates, or ninety days have elapsed. Expansion is
based on repeat session logging, comparison use, recommendation follow-up,
helpfulness, trackside entry speed, and AI safety—not signup count alone.

Do not start car-specific expansion, coach mode, event mode, tire lifecycle, or
team sharing before this review.

Work queue items `R1`, `R2`, and `R3` must clear before the gate is read. `R3` in
particular decides whether the AI guidance number means anything: a missing index
makes every rider look unguided, so the report would be measuring an outage rather
than rider behavior.

The within-day loop counts carry the same caveat for a different reason.
`computeWithinDayLoops` in `scripts/lib/beta-report-metrics.mjs` decides that a
session changed from its `session_changes` rows, and until `fetchPreviousSession`
(`lib/session-previous.ts`) replaced the raw previous-session predicate, no
`previous` row was written for a same-day session logged without a start time. A
rider with no vehicle baseline had no row written at all, so a track day of real
setup changes between runs still registered zero loops. Those counts only reflect
rider behavior for sessions logged after that fix.

Use `npm run beta:report` for the decision snapshot and follow
[`docs/beta-runbook.md`](./beta-runbook.md) for cohort operations.
