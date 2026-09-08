// Loaded by `instrumentation.ts` on the Node.js runtime.
import * as Sentry from '@sentry/nextjs';
import { sentryEnabled, sharedSentryOptions } from '@/lib/sentry-options';

if (sentryEnabled) {
  Sentry.init(sharedSentryOptions);
}
