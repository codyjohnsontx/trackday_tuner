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
| `/api/health` | **Yes.** Public, no monitoring-specific variable, no account | Nothing new. It does use the app's existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and needs `data/rag-index.json` in the bundle - those are what it checks |
| `/api/monitoring/ai-health` | No - answers `503 Monitoring is not configured.` | `MONITORING_CRON_SECRET` in Vercel |
| The 15-minute probe + alert | No - the workflow runs but exits clean with a warning | Two GitHub settings plus the Vercel secret and a redeploy. **No external account** |
| Sentry | No - the SDK is not initialised at all | A sentry.io account (free tier) you create |
| Log drain | No - there is no code for it | A Better Stack or Axiom account you create |

**The most useful line on this page:** the alert that catches an R3-shaped
outage is the GitHub Actions one, and it costs you nothing but the three
settings and a redeploy in step 2 below: a failed scheduled workflow run
notifies you by email, with no vendor, no plan and no card. Do all of step 2,
not just the GitHub half - the workflow's own configuration check reads only the
two GitHub values, so setting those alone leaves it reporting itself configured
while the AI probe answers `503 Monitoring is not configured.` and reddens the
run every fifteen minutes. Sentry adds the stack trace behind a failure; it
does not add the alarm. Do step 1 and step 2 and the claim is true. Steps 3 and
4 make a failure faster to diagnose.

**That email has a dependency worth knowing before you rely on it**, because it
is not "GitHub emails the repository owner". GitHub sends a failed
scheduled-workflow notification to **the user who created the workflow, or
whoever last edited the cron line**, and only if *that* user has Actions email
notifications enabled. Today that user is you, by authorship rather than by
design - the cron in `.github/workflows/monitoring.yml` was committed under your
identity and nothing since has touched that line. It **moves to somebody else
the moment they edit the cron**, which on a repository worked by agents is a
live possibility rather than a hypothetical. Whether your own Actions email
notifications are on cannot be checked from inside the repository. So confirm it
once, with step 2's last item, rather than assuming it.

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
   - Value: the string from item 1 above
   - Environments: **Production**

3. **GitHub** → the repo → Settings → Secrets and variables → **Actions**:

   - **Variables** tab → New repository variable
     - Name: `MONITORING_APP_URL`
     - Value: the production URL, no trailing path - e.g.
       `https://trackdaytuner.vercel.app`
   - **Secrets** tab → New repository secret
     - Name: `MONITORING_CRON_SECRET`
     - Value: **the same string you put in Vercel in item 2 above.** They have
       to match exactly; a mismatch is a `401` every fifteen minutes.

4. **Redeploy.** A Vercel environment variable only reaches a deployment built
   after it was set, so the running deployment still has no secret until you
   redeploy (Deployments → the latest one → ⋯ → Redeploy).

**Verify it worked**, in this order:

```bash
# 200 + a JSON summary       = wired up, and nothing is wrong.
# 503 {"status":"alerting"}  = wired up, and the alert is doing its job. Read the
#                              reasons it lists; the wiring is not the problem.
# 503 {"status":"unknown"}   = wired up, but the read of `ai_requests` itself
#                              failed or timed out, so there are no numbers to
#                              judge. That is Supabase rather than the wiring -
#                              step 1's curl says whether it is reachable at all.
# 503 {"error":"Monitoring is not configured."} = Vercel has no secret, or you
#                              did not redeploy.
# 401                        = the secrets disagree.
# any 3xx                    = MONITORING_APP_URL is not the canonical host. Use
#                              the host Vercel serves directly, not an apex or
#                              alias that redirects to it.
#
# The secret is typed at a prompt and fed to curl on stdin rather than written
# into the command. Pasted inline it would land in your shell history and in
# curl's argv, where any other process on the machine can read it.
printf 'Monitoring secret: '; read -rs SECRET </dev/tty; printf '\n'
printf 'header = "Authorization: Bearer %s"\nurl = "%s"\n' \
  "$SECRET" "https://<your-app>/api/monitoring/ai-health" | curl -i --config -
unset SECRET
```

Then GitHub → Actions → **Monitoring** → Run workflow. A configured run shows
two probe steps that both print `HTTP 200` while nothing is wrong. If the AI
alert is genuinely firing, that step prints `HTTP 503` and fails the run on
purpose - that is the alert working, not the setup failing, and the curl above
says what failed. An unconfigured one shows a yellow `::warning::` saying
monitoring is not wired up yet and does nothing else - if you see that, the
GitHub variable and secret in item 3 above did not take.

From then on it runs every 15 minutes.

5. **Prove the notification actually reaches you. Do this once.** Everything
   above only shows that the probes answer; it does not show that a *failure*
   reaches a human, and that is the whole claim. Nothing else on this page
   establishes it, and the dependency described at the top is why.

   Temporarily point `MONITORING_APP_URL` at a URL that cannot answer - append
   `/nope` to it - then Actions → **Monitoring** → Run workflow. The run must go
   red. Then check that you actually received the email, including your spam
   folder. Put the variable back when you are done.

   - **Mail arrived:** the alert channel works end to end. Nothing more to do.
   - **No mail:** GitHub → Settings → Notifications → Actions, and turn on email
     for failed workflows. If it still does not arrive, this repository has *no*
     working zero-account alert path, and a webhook or an external uptime
     monitor (both below) stops being optional.

   Do this again if anyone ever edits the `cron:` line, because that moves who
   gets notified.

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

**Verify it worked.** Two checks, and only the second one proves anything.

A quick smoke test first: open the deployed site, open the browser console and
type `window.__SENTRY__`. `undefined` means the DSN never reached the build, so
stop and fix that. But an object is **not** proof - it is an internal carrier,
and it tells you the SDK module loaded, not that it initialised with a working
DSN and not that a single event was ever delivered.

**This does not fold into step 2's item 5.** That item points
`MONITORING_APP_URL` at `<app>/nope`, and the workflow then requests
`<app>/nope/api/health` - a path no route matches, so Next answers `404` and
`app/api/health/route.ts` never runs. No check fails, `reportError` is never
called, and Sentry stays empty by construction. Item 5 proves the email and
nothing else.

What proves delivery is a real error, and the cheapest way to see one is to
wait for it: a brand-new Sentry project shows **"waiting for first event"** on
its dashboard until one arrives, so that banner disappearing is your proof, at
no risk to anybody. Leave it and get on with something else.

If you want it proven now rather than eventually, force an error on a **preview
deployment** - item 2 above sets `NEXT_PUBLIC_SENTRY_DSN` for Preview as well as
Production, so a throw on a preview branch reaches the same Sentry project and
costs no rider anything. Do **not** break production to test this: clearing the
Supabase key or the RAG index takes the app down for everyone for as long as the
test runs.

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
makes the ~45 server-side `console.error` calls across `app/` and `lib/`
searchable and keeps them past Vercel's own short retention. The three in
`components/` are not among them: a drain carries build, function and edge
logs, and those three run in the rider's browser, so nothing leaves the device.
Sentry (step 3) is the only channel that catches a client-side failure.

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

`.env.example` carries the app-side ones for local work. `MONITORING_APP_URL`
is deliberately not among them: nothing in the app reads it, only
`.github/workflows/monitoring.yml` does.

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
- **No session replay, no breadcrumbs, and no headers, cookies or request bodies
  on an issue.**
  Replay records what a rider types, and the session form carries the free text
  the prompt pipeline already treats as untrusted (`lib/rag/prompt.ts`).
  `sendDefaultPii: false` is set, but do not read it as more than it is: on the
  event path it gates **none** of cookies, headers or the body - its deny list
  is IP-revealing header names only. Left alone, an issue would carry the
  rider's `sb-<ref>-auth-token` cookie, which holds their access **and** refresh
  token, and the `Authorization: Bearer` header carrying
  `MONITORING_CRON_SECRET`. The `beforeSend` in `lib/sentry-options.ts` is what
  drops all three. `maxBreadcrumbs: 0` beside it closes a separate channel
  `beforeSend` never sees: the SDK's `Console` integration keeps every
  `console.*` call with its raw arguments, which would put back the identifiers
  `reportError`'s allow list withholds, and the `Http` one keeps outgoing query
  strings, where a PostgREST read carries `user_id=eq.<uuid>`. Between them an
  issue carries the error, the stack, the method and the URL - and not the
  rider's credentials or what they wrote.

  **What that costs, stated plainly.** Both of those producers are server-side,
  but `lib/sentry-options.ts` is one options object shared by the server, edge
  and browser initialisers, so the browser loses its breadcrumbs too. There the
  loss is not covered by anything: a drain carries build, function and edge logs
  (step 4), so a rider's browser writes nowhere and Sentry is the only channel
  that sees a client-side failure. A React error in the app therefore reaches
  you with its stack and **no** record of which route the rider came from or
  which control they pressed. That is accepted, not overlooked - the blanket
  setting is the safer default, and narrowing it means a second, client-only
  code path with a privacy surface of its own. If the missing trail ever costs
  more than it saves, the fix is a client `beforeBreadcrumb` keeping
  `navigation` and `ui.click` while dropping `console` and `fetch`/`xhr`.

## Where an alert goes

Three channels, in order of how little setup they need:

1. **A failed scheduled workflow run.** `monitoring.yml` fails when either probe
   is not `200`, and GitHub emails a failed scheduled run to the workflow's
   creator or whoever last edited the `cron:` line, if that user has Actions
   email notifications on. This needs no external account, and it is the only
   channel that does - which is exactly why step 2's item 5 has you prove it
   arrives once instead of trusting it. Nothing here configures a recipient, so
   this channel follows commit authorship rather than a setting in this repo.
2. **A webhook.** `MONITORING_ALERT_WEBHOOK_URL`, above.
3. **An external uptime monitor** pointed at `/api/health`, above.

## Why a GitHub Actions schedule and not Vercel Cron

Vercel Cron is the obvious home for this - it is one `vercel.json` entry, it
runs inside the deployment, and the route already accepts the exact
`Authorization: Bearer` header it sends. It was not used because **a `*/15`
schedule requires a Vercel Pro subscription**: the Hobby plan allows cron jobs
but caps them at two, triggered once a day, which is not a monitor. A GitHub
Actions schedule runs every 15 minutes on a free account, and a failed run is
itself emailed, so the alert channel comes with it - subject to the actor and
notification-settings dependency described at the top of this page, which is
worth reading before leaning on it.

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
  than the noise. This is about the schedule; the next bullet is a different
  thing.
- **`/api/health` reports every failing check, and it is public.** The endpoint
  is unauthenticated by design, and each failing check writes one log line and
  one Sentry event. So while a dependency is down, the volume is set by how
  often the endpoint is *called* rather than by the outage: the documented
  callers alone (the 15-minute workflow plus a 5-minute external monitor)
  produce roughly 32 events an hour with both checks failing, and anyone can
  raise that by looping the URL - during exactly the window Sentry's free tier
  needs to still be accepting events. Accepted because a health check that
  reports nothing defeats its own purpose, and it has to stay reachable by an
  external monitor. `/api/monitoring/ai-health` decides the opposite one route
  over, and the difference is real: its silent branch is reachable *before* any
  credential is checked and describes a documented configuration state rather
  than a fault, whereas this one only reports when a check genuinely fails.
- **A failed reservation insert writes no row**, so a Supabase outage that stops
  `reservePendingSlot` is invisible to the `ai_requests` alert. `/api/health`'s
  Supabase check is what covers that case.
- **The scheduled probe is best effort.** GitHub delays scheduled runs under
  load. The alert window is an hour, so a late run still sees the same failures.
