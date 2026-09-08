import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';

import { sharedSentryOptions } from '@/lib/sentry-options';

// `sendDefaultPii: false` does not gate the request body. The Node SDK captures
// incoming bodies onto the isolation scope and attaches them to every event, so
// without this an `ai/tuning-advice` 500 would carry the rider's question,
// symptoms and change intent to sentry.io.
describe('sharedSentryOptions.beforeSend', () => {
  const beforeSend = (event: ErrorEvent): ErrorEvent =>
    sharedSentryOptions.beforeSend(event);

  it('drops a captured request body carrying rider free text', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://trackdaytuner.app/api/ai/tuning-advice',
        method: 'POST',
        data: JSON.stringify({
          question: 'the bike pushes wide on corner exit at Barber',
          symptoms: ['understeer'],
          change_intent: 'softer rear rebound',
        }),
      },
    } satisfies ErrorEvent;

    const sent = beforeSend(event);

    expect(sent.request).toBeDefined();
    expect(sent.request).not.toHaveProperty('data');
  });

  // The point is to drop the body and nothing else: which URL 500'd is the
  // first thing an operator needs.
  it('keeps the rest of the request', () => {
    const sent = beforeSend({
      type: undefined,
      request: {
        url: 'https://trackdaytuner.app/api/ai/day-plan',
        method: 'POST',
        data: 'anything the rider typed',
      },
    });

    expect(sent.request?.url).toBe('https://trackdaytuner.app/api/ai/day-plan');
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
