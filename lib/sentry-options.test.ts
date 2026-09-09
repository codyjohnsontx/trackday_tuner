import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import type { ErrorEvent } from '@sentry/nextjs';

import { reportError } from '@/lib/monitoring/report-error';
import { sharedSentryOptions } from '@/lib/sentry-options';

type SentryClient = Parameters<typeof Sentry.setCurrentClient>[0];

// `sendDefaultPii: false` gates none of this on the event path - its deny list
// is IP-revealing header names only. Without `beforeSend` an issue would carry
// the rider's Supabase session cookie (access + refresh token), the monitoring
// cron secret, and the AI request body holding their free text.
describe('sharedSentryOptions.beforeSend', () => {
  const beforeSend = (event: ErrorEvent): ErrorEvent =>
    sharedSentryOptions.beforeSend(event);

  const riderRequestEvent = (): ErrorEvent => ({
    type: undefined,
    request: {
      url: 'https://trackdaytuner.app/api/ai/tuning-advice',
      method: 'POST',
      headers: {
        cookie: 'sb-abcdef-auth-token=base64-access-and-refresh-token',
        authorization: 'Bearer the-monitoring-cron-secret',
        'content-type': 'application/json',
      },
      cookies: { 'sb-abcdef-auth-token': 'base64-access-and-refresh-token' },
      data: JSON.stringify({
        question: 'the bike pushes wide on corner exit at Barber',
        symptoms: ['understeer'],
        change_intent: 'softer rear rebound',
      }),
    },
  });

  it('drops the headers, the cookies and the body', () => {
    const sent = beforeSend(riderRequestEvent());

    expect(sent.request).toBeDefined();
    expect(sent.request).not.toHaveProperty('headers');
    expect(sent.request).not.toHaveProperty('cookies');
    expect(sent.request).not.toHaveProperty('data');
  });

  // The point is to drop those three and nothing else: which URL 500'd is the
  // first thing an operator needs.
  it('keeps the method and the URL', () => {
    const sent = beforeSend(riderRequestEvent());

    expect(sent.request?.url).toBe('https://trackdaytuner.app/api/ai/tuning-advice');
    expect(sent.request?.method).toBe('POST');
  });

  it('returns an event with no request unchanged', () => {
    const event = {
      type: undefined,
      exception: { values: [{ type: 'MissingKnowledgeIndexError' }] },
    } satisfies ErrorEvent;

    expect(beforeSend(event)).toBe(event);
  });
});

// Breadcrumbs are a channel `beforeSend` never sees: the SDK writes them to the
// isolation scope and merges them onto the event afterwards. The `Console`
// integration is on by default under `@sentry/nextjs`, and `reportError` logs
// its full context before it captures - so without `maxBreadcrumbs: 0` an issue
// carries the rider identifiers that `REPORTABLE_EXTRA_KEYS` withholds from
// `extra`. This drives the real integration and the real `addBreadcrumb`, which
// is the code that reads the option.
describe('sharedSentryOptions and breadcrumbs', () => {
  const originalConsoleError = console.error;

  const startSentry = (options: Record<string, unknown>): void => {
    const client = {
      getOptions: () => options,
      emit: () => {},
      registerCleanup: () => {},
      captureException: () => 'event-id',
    } as unknown as SentryClient;

    Sentry.setCurrentClient(client);
    Sentry.consoleIntegration().setup?.(client);
    Sentry.getIsolationScope().clearBreadcrumbs();
  };

  const logRiderContext = (): void => {
    reportError('ai/day-plan', new Error('sessions read failed'), {
      requestId: 'req-1',
      userId: 'user-uuid',
      vehicleId: 'vehicle-uuid',
      query: 'sessions',
    });
  };

  const collectedBreadcrumbs = (): unknown[] =>
    Sentry.getIsolationScope().getScopeData().breadcrumbs;

  // Silenced once, for the whole file, because the integration patches whatever
  // `console.error` is when it is set up - a per-test spy installed afterwards
  // would replace the patched function and stop the instrumentation running.
  beforeAll(() => {
    console.error = () => {};
  });

  afterAll(() => {
    Sentry.getIsolationScope().clearBreadcrumbs();
    console.error = originalConsoleError;
  });

  it('records no breadcrumb for the context reportError logs', () => {
    startSentry(sharedSentryOptions);

    logRiderContext();

    expect(collectedBreadcrumbs()).toEqual([]);
  });

  // The control: left at the SDK default, the very same call keeps the rider's
  // id and their bike's id on the scope the next event is built from.
  it('would carry the rider identifiers at the SDK default', () => {
    startSentry({});

    logRiderContext();

    expect(JSON.stringify(collectedBreadcrumbs())).toContain('user-uuid');
    expect(JSON.stringify(collectedBreadcrumbs())).toContain('vehicle-uuid');
  });
});
