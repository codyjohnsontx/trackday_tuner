import * as Sentry from '@sentry/nextjs';

/**
 * Next calls this once per server runtime at startup. The two configs are
 * imported dynamically because each pulls in a different build of the SDK and
 * only one of them can run in a given runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Next hands every *unhandled* error from a route handler, server component or
 * server action here.
 *
 * That is worth knowing precisely, because it is not the whole story for this
 * app: both AI routes catch their own errors to write the `ai_requests` audit
 * row and return a JSON 500, so nothing they fail on ever reaches this hook.
 * They report through `reportError` in `lib/monitoring/report-error.ts`
 * instead - which is what actually makes R3's `MissingKnowledgeIndexError`
 * raise a Sentry issue.
 */
export const onRequestError = Sentry.captureRequestError;
