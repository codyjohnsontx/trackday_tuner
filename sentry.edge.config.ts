// Loaded by `instrumentation.ts` on the edge runtime. Nothing runs there today:
// `proxy.ts`, which replaced the `middleware.ts` that did, is Node.js only, and
// no route handler opts into the edge runtime. It stays so a route that does is
// still reported - `register()` imports it by name.
import * as Sentry from '@sentry/nextjs';
import { sentryEnabled, sharedSentryOptions } from '@/lib/sentry-options';

if (sentryEnabled) {
  Sentry.init(sharedSentryOptions);
}
