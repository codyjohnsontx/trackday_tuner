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
import type { ErrorEvent } from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export const sentryEnabled = Boolean(SENTRY_DSN);

export const sharedSentryOptions = {
  dsn: SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  // There is deliberately no `tracesSampleRate`: tracing is excluded from the
  // bundle entirely by `bundleSizeOptimizations.excludeTracing` in
  // next.config.ts, where the reasoning lives. Setting a rate here would only
  // ship an option nothing reads.

  // Session Replay is never added as an integration, and `sendDefaultPii: false`
  // puts `cookie`, `sb-`, `auth` and `session` on a deny list, so the rider's
  // Supabase session cookie never leaves the process.
  sendDefaultPii: false,

  // Neither of those covers the request BODY, which the Node SDK captures on a
  // path `sendDefaultPii` does not gate: the `httpIntegration` that
  // `@sentry/nextjs` installs keeps `maxRequestBodySize` at its 10 kB default,
  // copies what the handler reads onto the isolation scope, and
  // `requestDataIntegration` then attaches it to every event unconditionally.
  // On the AI routes that body is the rider's question, symptoms and change
  // intent - the free text the prompt pipeline already treats as untrusted, see
  // the `<user_data>` handling in lib/rag/prompt.ts - and `reportError` sends an
  // event from both routes' catch blocks. It is dropped here rather than by
  // reconfiguring `httpIntegration`, so server, edge and client are covered from
  // one place and a future change to that integration's defaults cannot reopen
  // it.
  beforeSend(event: ErrorEvent): ErrorEvent {
    if (event.request) delete event.request.data;
    return event;
  },
} as const;
