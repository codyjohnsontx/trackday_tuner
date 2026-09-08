// The browser initialiser. Next 15.3+ loads this file for the client runtime;
// it replaces the old `sentry.client.config.ts`.
import * as Sentry from '@sentry/nextjs';
import { sentryEnabled, sharedSentryOptions } from '@/lib/sentry-options';

if (sentryEnabled) {
  Sentry.init(sharedSentryOptions);
}

// Lets Sentry tie a client-side navigation to the spans it produces.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
