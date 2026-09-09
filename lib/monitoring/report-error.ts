import * as Sentry from '@sentry/nextjs';

/**
 * The context keys allowed to leave the process on a Sentry issue.
 *
 * This is an ALLOW list, and that direction is the whole point: a deny list of
 * sensitive-looking names is exactly the pattern that failed inside the Sentry
 * SDK itself, where `sendDefaultPii: false` denies IP-revealing header names and
 * leaves `cookie` through (see `lib/sentry-options.ts`). A deny list is wrong by
 * default whenever someone adds a key; this fails closed instead, and a new
 * context key is simply absent from Sentry until somebody decides to add it here.
 *
 * Every name on it is an enum-ish operational value with no rider in it: which
 * check ran, which table or query failed, whether the caller will retry. The
 * identifiers callers pass - `userId` and `vehicleId` (stable, and they tie an
 * issue to one rider and their bike), `sessionId`, and `requestId` - are
 * deliberately NOT here.
 *
 * Losing `requestId` costs real correlation against the `ai_requests` audit row,
 * and that is an accepted trade rather than an oversight: `console.error` below
 * still writes the FULL context, so the complete picture stays in Vercel's logs
 * and in the log drain, which are first-party. What a third party holds is the
 * error, the stack, the scope tag and these few operational values.
 */
const REPORTABLE_EXTRA_KEYS = new Set(['check', 'query', 'table', 'reason', 'retriable']);

function reportableExtra(context: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (REPORTABLE_EXTRA_KEYS.has(key)) extra[key] = value;
  }
  return extra;
}

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
 * the DSN is not configured. It gets the whole context; Sentry gets
 * `REPORTABLE_EXTRA_KEYS` of it.
 */
export function reportError(
  scope: string,
  err: unknown,
  context: Record<string, unknown> = {},
): void {
  console.error(`[${scope}]`, err, context);
  Sentry.captureException(err, {
    tags: { scope },
    extra: reportableExtra(context),
  });
}
