import * as Sentry from '@sentry/nextjs';

/**
 * Report a caught error so it raises a Sentry issue.
 *
 * Next's `onRequestError` hook (see `instrumentation.ts`) only sees *unhandled*
 * errors, and this app's most important failures are all handled: both AI
 * routes catch, write an `ai_requests` audit row and return a JSON 500, and the
 * health checks catch so the probe can name which one broke. Every one of those
 * would be invisible to Sentry without this call - which would have left R3
 * (053c545) exactly as silent with error tracking installed as it was without
 * it, because `MissingKnowledgeIndexError` was caught on the way to the 500.
 *
 * `console.error` stays, and stays first. It is what a log drain indexes and
 * what shows up in `vercel logs`, and it is the only channel that works when
 * the DSN is not configured.
 */
export function reportError(
  scope: string,
  err: unknown,
  context: Record<string, unknown> = {},
): void {
  console.error(`[${scope}]`, err, context);
  Sentry.captureException(err, {
    tags: { scope },
    extra: context,
  });
}
