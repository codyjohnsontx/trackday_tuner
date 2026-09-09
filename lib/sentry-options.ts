/**
 * The Sentry settings the server, edge and client initialisers share.
 *
 * The DSN is `NEXT_PUBLIC_SENTRY_DSN` in all three. A DSN is not a secret - it
 * ships in the client bundle by design - and one name means one thing to set in
 * Vercel rather than three that can disagree.
 *
 * With no DSN nothing is initialised at all: `next build` in CI, `next dev` and
 * anyone's local checkout run with error tracking simply off, rather than with
 * an SDK trying to reach a project that does not exist.
 */
import type * as SentryTypes from '@sentry/nextjs';
import type { ErrorEvent } from '@sentry/nextjs';

/**
 * Exactly what `Sentry.init` accepts - the union of the browser, Node and edge
 * option contracts - so `satisfies` below checks these option NAMES against all
 * three runtimes this object is passed to.
 *
 * `as const` alone narrows the values and validates nothing: a misspelled option
 * would compile and be silently ignored by the SDK. That is not a style point
 * here, because `beforeSend` is what keeps the rider's session cookie and free
 * text out of Sentry - a typo in that key would be a privacy regression that
 * looks exactly like working code.
 */
type SentryInitOptions = Parameters<typeof SentryTypes.init>[0];

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export const sentryEnabled = Boolean(SENTRY_DSN);

export const sharedSentryOptions = {
  dsn: SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  // There is deliberately no `tracesSampleRate`: tracing is excluded from the
  // bundle entirely by `bundleSizeOptimizations.excludeTracing` in
  // next.config.ts, where the reasoning lives. Setting a rate here would only
  // ship an option nothing reads.

  // Session Replay is never added as an integration, so nothing records what a
  // rider types.
  //
  // `sendDefaultPii: false` does much less than its name suggests, and reading
  // it as "no rider data is sent" is the mistake to avoid. On the EVENT path it
  // gates neither cookies, nor headers, nor the request body: it resolves to
  // `{ deny: PII_HEADER_SNIPPETS }`, and that list is
  // `['forwarded', '-ip', 'remote-', 'via', '-user']` - IP-revealing headers
  // only. The list that does contain `cookie`, `auth` and `token` is applied to
  // SPANS, and this configuration emits none.
  sendDefaultPii: false,

  // Breadcrumbs are off entirely, and that is the second half of the boundary
  // rather than a tidiness setting. The SDK collects them on a channel
  // `beforeSend` never sees - `addBreadcrumb` writes them to the isolation
  // scope and `applyScopeDataToEvent` merges them onto the event - and two of
  // the default integrations feed it rider data:
  //
  // - `Console` records every `console.*` call, keeping the formatted message
  //   AND the raw arguments. `reportError` logs its full context before it
  //   captures, so an issue would carry the `userId`, `vehicleId`, `sessionId`
  //   and `requestId` that `REPORTABLE_EXTRA_KEYS` in
  //   lib/monitoring/report-error.ts exists to withhold - and every other
  //   `console.error` in this app besides, including the rider's email address
  //   from app/api/beta/signup/route.ts.
  // - `Http` records outgoing requests with `http.query`, and a PostgREST read
  //   carries `user_id=eq.<uuid>` there.
  //
  // Zero rather than a category filter: the channel is what leaks, so it is the
  // channel that goes, and nothing has to be re-judged when the SDK grows a new
  // breadcrumb source. `addBreadcrumb` returns before it builds one at all.
  // Nothing is lost that this app relies on - `console.error` still writes the
  // whole story, in order, to Vercel's logs and the log drain, which are
  // first-party.
  maxBreadcrumbs: 0,

  // `beforeSend` is what enforces the rest of it, and it drops all three:
  //
  // - `headers` carries `cookie` and `authorization`. Under `@supabase/ssr` the
  //   `sb-<ref>-auth-token` cookie is base64 JSON holding the access token AND
  //   the refresh token, so one issue would be a credential that mints sessions
  //   for that rider until it is revoked; `/api/monitoring/ai-health` carries
  //   `Authorization: Bearer $MONITORING_CRON_SECRET`. Both reach an event
  //   through `onRequestError` (instrumentation.ts) and through every
  //   `reportError` call on the Node runtime.
  // - `cookies` is the same session cookie again, parsed into a second field.
  // - `data` is the request body: on the AI routes, the rider's question,
  //   symptoms and change intent - the free text the prompt pipeline already
  //   treats as untrusted, see the `<user_data>` handling in lib/rag/prompt.ts.
  //
  // Headers go wholesale rather than by blanking `cookie`, `set-cookie` and
  // `authorization` by name, because a deny list of sensitive header names is
  // exactly what failed here: the SDK shipped one and `cookie` was not on it. A
  // header worth keeping should be re-added by name as an allow list, as a
  // decision somebody makes on purpose. What survives is the error, the stack,
  // the method and the URL.
  //
  // Do NOT swap this for the `dataCollection` option: `resolveDataCollectionOptions`
  // switches its base to the all-PII-on `DEFAULTS` as soon as that key is
  // present, so a partial object silently turns `userInfo` back on and starts
  // attaching the rider's IP. Keeping it here also covers server, edge and
  // client from one place.
  beforeSend(event: ErrorEvent): ErrorEvent {
    if (event.request) {
      delete event.request.headers;
      delete event.request.cookies;
      delete event.request.data;
    }
    return event;
  },
} as const satisfies SentryInitOptions;
