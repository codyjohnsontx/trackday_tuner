import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({ captureException }));

import { reportError } from '@/lib/monitoring/report-error';

describe('reportError', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  // The whole reason this module exists: Next's `onRequestError` only sees
  // unhandled errors, and every failure this app cares about is caught on the
  // way to a shaped 500.
  it('sends a caught error to Sentry as well as the log', () => {
    const err = new Error('RAG index not found');

    reportError('ai/tuning-advice', err, { requestId: 'req-1' });

    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { scope: 'ai/tuning-advice' },
      extra: { requestId: 'req-1' },
    });
  });

  // `console.error` is the only channel that works with no DSN configured, and
  // it is what a log drain indexes.
  it('logs first, so the log works with Sentry switched off', () => {
    const err = new Error('boom');

    reportError('health', err, { check: 'rag_index' });

    expect(consoleError).toHaveBeenCalledWith('[health]', err, { check: 'rag_index' });
  });

  it('takes a thrown non-Error', () => {
    reportError('health', 'a string nobody wrapped');

    expect(captureException).toHaveBeenCalledWith('a string nobody wrapped', {
      tags: { scope: 'health' },
      extra: {},
    });
  });
});
