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
const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export const sentryEnabled = Boolean(SENTRY_DSN);

export const sharedSentryOptions = {
  dsn: SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  // There is deliberately no `tracesSampleRate`: tracing is excluded from the
  // bundle entirely by `bundleSizeOptimizations.excludeTracing` in
  // next.config.ts, where the reasoning lives. Setting a rate here would only
  // ship an option nothing reads.

  // Session Replay is never added as an integration, and this keeps the rest of
  // the SDK from attaching rider data on its own: the session form carries free
  // text the prompt pipeline already treats as untrusted - see the
  // `<user_data>` handling in lib/rag/prompt.ts.
  sendDefaultPii: false,
} as const;
