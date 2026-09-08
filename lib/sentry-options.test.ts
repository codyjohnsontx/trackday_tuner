import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';

import { sharedSentryOptions } from '@/lib/sentry-options';

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
