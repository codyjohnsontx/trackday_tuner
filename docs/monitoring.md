# Monitoring

## Why this exists

R3 (`053c545`): `data/rag-index.json` was gitignored, never reached a Vercel
bundle, and every Race Engineer call returned 500 for roughly three months.
Pages kept rendering, and there was nothing in the logs to find: the catch that
handled every one of those calls wrote an `ai_requests` row and returned without
logging a line, and nothing on the retriever's path logged either. The only
signal was that table quietly not growing - which looks exactly like riders
losing interest. Nothing but a manual audit could have found it, and that is
what did, by which point it had already corrupted the beta success metric,
because `summarizeAiGuidance` counts a rider as guided only on a success status.

The product had instrumentation and no monitoring. These are the pieces that
close the gap.

## Read this first: what is live, and what is dark until you act

Merging this branch does not switch monitoring on by itself. Two pieces start
working on the next deploy, one needs fifteen minutes of your time and **no
external account at all**, and two need an account you have to create.

| Piece | Live on merge? | What it needs from you |
| --- | --- | --- |
| `/api/health` | **Yes.** Public, no variable, no account | Nothing |
| `/api/monitoring/ai-health` | No - answers `503 Monitoring is not configured.` | `MONITORING_CRON_SECRET` in Vercel |
| The 15-minute probe + alert | No - the workflow runs but exits clean with a warning | Two GitHub settings. **No external account** |
| Sentry | No - the SDK is not initialised at all | A sentry.io account (free tier) you create |
| Log drain | No - there is no code for it | A Better Stack or Axiom account you create |

**The most useful line on this page:** the alert that catches an R3-shaped
outage is the GitHub Actions one, and it costs you nothing but the two settings
in step 2 below. A failed scheduled workflow run emails the repository owner, so
that is a working alert channel with no vendor, no plan and no card. Sentry adds
the stack trace behind a failure; it does not add the alarm. Do step 1 and step
2 and the claim is true. Steps 3 and 4 make a failure faster to diagnose.

## Set it up

Everything below is a copy-paste step with a way to check it worked. Nothing
here needs any context from the branch that added it.

### Step 1 - `/api/health` (nothing to do, but verify it)

After the next production deploy:

```bash
curl -i https://<your-app>/api/health
```

Expect `HTTP/2 200` and a body naming two checks:

```json
{"status":"ok","checked_at":"...","checks":[
  {"name":"supabase","status":"ok","duration_ms":10},
  {"name":"rag_index","status":"ok","duration_ms":8,"detail":"75 chunks"}]}
```

If `rag_index` says `"status":"fail"`, that is R3 happening again and the deployment
cannot answer a Race Engineer question. The response is `503` and the failing
check is named.

### Step 2 - the 15-minute alert (no external account)

1. Make a secret. Any random string; this one is fine:

   ```bash
   openssl rand -hex 32
   ```

2. **Vercel** → your project → Settings → Environment Variables → Add:

   - Key: `MONITORING_CRON_SECRET`
   - Value: the string from step 1
   - Environments: **Production**

3. **GitHub** → the repo → Settings → Secrets and variables → **Actions**:

   - **Variables** tab → New repository variable
     - Name: `MONITORING_APP_URL`
     - Value: the production URL, no trailing path - e.g.
       `https://trackdaytuner.vercel.app`
   - **Secrets** tab → New repository secret
     - Name: `MONITORING_CRON_SECRET`
     - Value: **the same string as step 2.** They have to match exactly; a
       mismatch is a `401` every fifteen minutes.

4. **Redeploy.** A Vercel environment variable only reaches a deployment built
   after it was set, so the running deployment still has no secret until you
   redeploy (Deployments → the latest one → ⋯ → Redeploy).

**Verify it worked**, in this order:

```bash
# Should be 200 and a JSON summary. 401 = the secrets disagree.
# 503 "Monitoring is not configured." = Vercel has no secret, or you did not redeploy.
curl -i -H "Authorization: Bearer <the secret>" \
  https://<your-app>/api/monitoring/ai-health
```

Then GitHub → Actions → **Monitoring** → Run workflow. A configured run shows
two probe steps that both print `HTTP 200`. An unconfigured one shows a yellow
`::warning::` saying monitoring is not wired up yet and does nothing else - if
you see that, step 3 above did not take.

From then on it runs every 15 minutes and a failure emails you.

### Step 3 - Sentry (needs an account you create)

Free tier is enough. No plan was chosen for you.

1. sentry.io → create a project → platform **Next.js** → copy the DSN. It looks
   like `https://abc123@o12345.ingest.sentry.io/678901`. A DSN is not a secret;
   it ships in the client bundle by design.
2. **Vercel** → Settings → Environment Variables → Add:
   - Key: `NEXT_PUBLIC_SENTRY_DSN`
   - Value: the DSN
   - Environments: **Production** and **Preview**
3. Redeploy.
4. In Sentry → Alerts, confirm the default **"a new issue is created"** rule is
   on. It is on by default for a new project. Without a rule, Sentry collects
   issues and tells nobody.

**Verify it worked:** open the deployed site, open the browser console and type
`window.__SENTRY__`. An object means the DSN reached the client bundle and the
SDK initialised; `undefined` means the variable did not reach the build. The
server side is proven the first time something actually throws - `reportError`
writes a `console.error` line at the same moment it sends, so the Vercel log
line and the Sentry issue should appear together.

Optional, and separate: source maps. Set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
`SENTRY_PROJECT` in the Vercel **build** environment and stack traces point at
real filenames instead of minified ones. With no token the build skips the
upload silently and on purpose, so leaving these unset costs you readability and
nothing else.

### Step 4 - log drain (needs an account you create)

There is no code for this; it is dashboard configuration only, which is why the
branch could not do it.

Vercel → project → Settings → Log Drains → Add. Better Stack and Axiom both
have a free tier that covers this volume; **neither was chosen for you.** It
makes the ~50 `console.error` calls across `app/`, `lib/` and `components/`
searchable and keeps them past Vercel's own short retention.

**Verify it worked:** `curl https://<your-app>/api/health`, then find Vercel's
own request log line for `/api/health` in the drain. Do not search for
`[health]` or `[monitoring]` to check this - those tags are written only when
something has actually failed, so on a working deployment they are absent, and
their absence is good news rather than a broken drain.

### Optional - a webhook, and an external uptime monitor

- `MONITORING_ALERT_WEBHOOK_URL` in Vercel (Production), set to a Slack or
  Discord incoming webhook, gets you the alert text in chat instead of in email.
  The payload carries `text` and `content` with the same string so it renders in
  either. **Verify** by posting to the URL yourself first
  (`curl -X POST -H 'content-type: application/json' -d '{"text":"test","content":"test"}' <url>`),
  because the route only calls it when an alert is actually firing.
- An external uptime monitor pointed at `/api/health` (Better Stack and
  UptimeRobot both cover a 5-minute interval free). This is the only channel
  that still works when GitHub Actions is down.

## Every variable, in one table

| Variable | Where it goes | Required? | What breaks without it |
| --- | --- | --- | --- |
| `MONITORING_APP_URL` | GitHub repo **variable** (Actions) | For the alert | The workflow exits clean with a warning. No probe ever runs, and nothing tells you that except the warning |
| `MONITORING_CRON_SECRET` | GitHub repo **secret** (Actions) **and** Vercel env (Production) - identical in both | For the alert | Missing in GitHub: same clean-exit warning. Missing in Vercel: the route answers `503` to everyone, so the workflow fails every 15 minutes. Mismatched: `401` every 15 minutes |
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel env, Production + Preview | No | The Sentry SDK is never initialised. A caught failure still reaches `console.error` in the Vercel log, because `reportError` writes that line first - which is already more than R3 produced |
| `MONITORING_ALERT_WEBHOOK_URL` | Vercel env, Production | No | Alerts reach you through the failed workflow run instead. The route reports `notified: "none"`, which is not a failure |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Vercel **build** env | No | The build skips the source map upload. Sentry stack traces point at minified code |

`.env.example` carries all of them for local work.

## What each piece actually checks

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
  suppressed them every time. That argument is about failures, and the failure
  rule is ungated because of it. **Latency is the one exception**: p95 needs at
  least five timed requests (`MIN_SAMPLES_FOR_P95`) before it can fire, so one
  slow answer cannot page on its own. A slow hour holding four requests will not
  alert.
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

## Where an alert goes

Three channels, in order of how little setup they need:

1. **A failed scheduled workflow run.** `monitoring.yml` fails when either probe
   is not `200`, and GitHub emails the repository owner on a failed scheduled
   run. This needs no external account.
2. **A webhook.** `MONITORING_ALERT_WEBHOOK_URL`, above.
3. **An external uptime monitor** pointed at `/api/health`, above.

## Why a GitHub Actions schedule and not Vercel Cron

Vercel Cron is the obvious home for this - it is one `vercel.json` entry, it
runs inside the deployment, and the route already accepts the exact
`Authorization: Bearer` header it sends. It was not used because **a `*/15`
schedule requires a Vercel Pro subscription**: the Hobby plan allows cron jobs
but caps them at two, triggered once a day, which is not a monitor. A GitHub
Actions schedule runs every 15 minutes on a free account, and a failed run
already emails the owner, so the alert channel comes with it.

The route is deliberately written so this is reversible with no code change:
add the `crons` entry to `vercel.json`, set `MONITORING_CRON_SECRET` in Vercel
(it is already there), and delete the workflow.

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
