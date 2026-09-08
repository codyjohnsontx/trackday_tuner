// The browser initialiser. Next 15.3+ loads this file for the client runtime;
// it replaces the old `sentry.client.config.ts`.
import * as Sentry from '@sentry/nextjs';
import { sentryEnabled, sharedSentryOptions } from '@/lib/sentry-options';

if (sentryEnabled) {
  Sentry.init(sharedSentryOptions);
}

// Sentry's App Router navigation hook, which Next calls on every client-side
// navigation. It is inert in this configuration: `captureRouterTransitionStart`
// does nothing unless a router transition handler has been registered, and only
// the browser-tracing integration registers one - tracing is excluded from the
// bundle (`bundleSizeOptimizations.excludeTracing` in next.config.ts). It is
// kept deliberately so that turning tracing on later is a change there and not
// also here.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
