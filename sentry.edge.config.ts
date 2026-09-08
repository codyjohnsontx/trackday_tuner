// Loaded by `instrumentation.ts` on the edge runtime, which is what
// `middleware.ts` runs on.
import * as Sentry from '@sentry/nextjs';
import { sentryEnabled, sharedSentryOptions } from '@/lib/sentry-options';

if (sentryEnabled) {
  Sentry.init(sharedSentryOptions);
}
