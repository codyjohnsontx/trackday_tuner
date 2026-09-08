# Monitoring

## Why this exists

R3 (`053c545`): `data/rag-index.json` was gitignored, never reached a Vercel
bundle, and every Race Engineer call returned 500 for roughly three months.
Pages kept rendering. The only signals were a `console.error` in a log nobody
was reading and an `ai_requests` table that stopped growing - which looks
exactly like riders losing interest. It was found by a manual audit, and it had
already corrupted the beta success metric, because `summarizeAiGuidance` counts
a rider as guided only on a success status.

The product had instrumentation and no monitoring. These are the pieces that
close the gap.

## What is checked, and what each piece would have caught

| Piece | Answers | Catches R3? |
| --- | --- | --- |
| `/api/health` | Is Postgres reachable, and does the RAG index load *in this bundle*? | Yes, on the first deploy |
| `/api/monitoring/ai-health` | Has anything failed in the last hour? Error rate, p95 latency | Yes, on the first rider call |
| `.github/workflows/monitoring.yml` | Runs both every 15 minutes and fails the run when either says no | This is what makes them alerts |
| Sentry | The stack trace behind an individual failure | Yes - but only because handled errors are reported explicitly, see below |

### `/api/health`

`200` when the deployment can serve, `503` with a named failing check when it
cannot. Public, uncached, and excluded from the middleware matcher so it depends
on as little as possible. The body carries an error *name* and never a message,
because `MissingKnowledgeIndexError`'s own message embeds the absolute index
path.

```json
{"status":"ok","checked_at":"...","checks":[
  {"name":"supabase","status":"ok","duration_ms":10},
  {"name":"rag_index","status":"ok","duration_ms":8,"detail":"75 chunks"}]}
```

The RAG check has to run in a route that carries the index, and each serverless
function is its own bundle - so `/api/health` has its own
`outputFileTracingIncludes` entry in `next.config.ts`.
`tests/unit/rag-index-bundling.test.ts` walks the import graph of every API
route and fails any that can reach `lib/rag/retriever` without one.

### `/api/monitoring/ai-health`

The alert built on the `ai_requests` audit table. Authenticated with
`Authorization: Bearer $MONITORING_CRON_SECRET` - the header Vercel Cron sends,
so the schedule can move there later with no change to the route. `200` when
healthy, `503` when a threshold is crossed, so `curl --fail` is enough to turn
it into an alert.

The thresholds and the classification live in `lib/monitoring/ai-health.ts` as
constants, not environment variables: they are load-bearing enough that changing
one should be a diff somebody reviews. Two rules matter most:

- **Any failure at all in the window alerts.** Error *rate* alone would not have
  caught R3 - riders stopped calling a feature that never worked, so the windows
  that mattered held one or two requests and any minimum-sample rule would have
  suppressed them every time.
- **An unrecognised status counts as a failure.** A monitor that treats what it
  does not understand as healthy reproduces the exact defect it exists to catch.
  If a new status starts alerting, the alert names it; classify it in
  `lib/monitoring/ai-health.ts`.

Refusals, rate limiting and duplicate suppression are *not* failures. Each is a
guard working, and counting them would make the alert fire hardest when the
product is behaving best.

### Sentry

`@sentry/nextjs`, initialised from `lib/sentry-options.ts` in three places:
`sentry.server.config.ts`, `sentry.edge.config.ts` and
`instrumentation-client.ts`. With no `NEXT_PUBLIC_SENTRY_DSN` nothing is
initialised at all, so CI, `next dev` and anyone's checkout run with error
tracking simply off rather than with an SDK reaching for a project that does not
exist.

**Next's `onRequestError` hook only sees *unhandled* errors, and almost nothing
in this app is unhandled.** Both AI routes catch, write an `ai_requests` audit
row and return a shaped JSON 500; the health checks catch so the probe can name
which one broke. Installing Sentry and stopping there would have left R3 exactly
as invisible as it was without it, because `MissingKnowledgeIndexError` was
caught on the way to that 500. `reportError` in
`lib/monitoring/report-error.ts` is what closes that, and it is the call to add
to any new catch block that swallows a failure. It logs first - `console.error`
is the only channel that works with no DSN, and it is what a log drain indexes.

Two deliberate settings:

- **No tracing.** `bundleSizeOptimizations.excludeTracing` in `next.config.ts`
  strips it from the bundle, which is the difference between +82 kB and +33 kB
  of shared JS on a mobile-first app. The performance question tracing would
  answer - how slow is the AI path - is already answered from `ai_requests` by
  `/api/monitoring/ai-health`.
- **No session replay and `sendDefaultPii: false`.** Replay records what a rider
  types, and the session form carries the free text the prompt pipeline already
  treats as untrusted (`lib/rag/prompt.ts`).

Wiring it up: create a project at sentry.io (free tier), copy the DSN, and set
`NEXT_PUBLIC_SENTRY_DSN` in Vercel for Production and Preview. Source maps are
optional and separate: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` in
the Vercel build environment. With no token the build skips the upload and the
release, silently and on purpose.

Then set an alert rule in Sentry - "a new issue is created" is the one that
matters, and it is on by default.

### Log drain

Not code. Vercel → project → Settings → Log Drains → add Better Stack or Axiom
(both free at this volume). It makes the ~50 `console.error` calls in `app/`, `lib/` and `components/` searchable and
keeps them past Vercel's own short retention. It is the fourth line of defence,
not one of the three that answer "is it broken" - those are above.

## Where an alert goes

Three channels, in order of how little setup they need:

1. **A failed scheduled workflow run.** `monitoring.yml` fails when either probe
   is not `200`, and GitHub emails the repository owner on a failed scheduled
   run. This needs no external account.
2. **A webhook.** Set `MONITORING_ALERT_WEBHOOK_URL` on the deployment to a
   Slack or Discord incoming webhook. The payload carries `text` and `content`
   with the same string, so it renders in either.
3. **An external uptime monitor** pointed at `/api/health`. Better Stack and
   UptimeRobot both have a free tier that covers a 5-minute interval; this is the
   only channel that survives GitHub Actions being down.

## Wiring it up

1. Pick a secret: `openssl rand -hex 32`.
2. Vercel → project → Settings → Environment Variables: add
   `MONITORING_CRON_SECRET` with that value, for Production. Optionally add
   `MONITORING_ALERT_WEBHOOK_URL`.
3. GitHub → repo → Settings → Secrets and variables → Actions:
   - **Variables** tab: `MONITORING_APP_URL` = the production URL, e.g.
     `https://trackdaytuner.vercel.app`
   - **Secrets** tab: `MONITORING_CRON_SECRET` = the same value as step 2
4. Redeploy so the deployment picks up the new environment variables.
5. Run the workflow by hand (Actions → Monitoring → Run workflow) and read the
   output. Until steps 2-3 are done it exits clean with a warning rather than
   failing every 15 minutes, because an alert channel that cries wolf from the
   day it merges is one nobody reads by the time it matters.
6. Separately, set `NEXT_PUBLIC_SENTRY_DSN` (see Sentry above) and add the log
   drain. Neither is needed for the probe to work; both make a failure it
   reports faster to diagnose.

Verify by hand:

```bash
curl -i https://<app>/api/health
curl -i -H "Authorization: Bearer $MONITORING_CRON_SECRET" \
  https://<app>/api/monitoring/ai-health
```

## Known limits

- **GitHub disables a scheduled workflow in a public repository after 60 days
  with no commit activity.** Re-enabling it is a button in the Actions tab. This
  is the one way the schedule can go quiet without saying so, and it is why the
  external uptime monitor is worth the ten minutes.
- **No alert de-duplication.** A sustained outage fires every 15 minutes.
  Suppressing repeats needs somewhere to keep the last alert state, and the
  failure mode of getting that wrong - silence during a real outage - is worse
  than the noise.
- **A failed reservation insert writes no row**, so a Supabase outage that stops
  `reservePendingSlot` is invisible to the `ai_requests` alert. `/api/health`'s
  Supabase check is what covers that case.
- **The scheduled probe is best effort.** GitHub delays scheduled runs under
  load. The alert window is an hour, so a late run still sees the same failures.
