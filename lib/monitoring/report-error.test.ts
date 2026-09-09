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

    reportError('ai/tuning-advice', err, { check: 'rag_index' });

    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { scope: 'ai/tuning-advice' },
      extra: { check: 'rag_index' },
    });
  });

  // `beforeSend` in lib/sentry-options.ts scrubs what the SDK collects by
  // itself; it does not touch `extra`, which is the channel this module hands
  // over deliberately. `userId` and `vehicleId` are stable - they tie an issue
  // to one rider and their bike - and every AI route passes them.
  it('keeps identifiers out of the Sentry extra', () => {
    const err = new Error('sessions read failed');

    reportError('ai/day-plan', err, {
      requestId: 'req-1',
      userId: 'user-uuid',
      vehicleId: 'vehicle-uuid',
      sessionId: 'session-uuid',
      query: 'sessions',
    });

    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { scope: 'ai/day-plan' },
      extra: { query: 'sessions' },
    });
  });

  // The allow list has to fail CLOSED, because the failure it exists to prevent
  // is somebody adding a context key later and nobody noticing it ships.
  it('drops a context key nobody has allowed yet', () => {
    reportError('ai/day-plan', new Error('boom'), { riderNotes: 'what the rider typed' });

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { scope: 'ai/day-plan' },
      extra: {},
    });
  });

  // The full context still has to reach the log drain, which is first-party -
  // that is what makes dropping `requestId` from Sentry an acceptable trade
  // rather than losing the correlation entirely.
  it('logs the whole context even though Sentry gets a subset', () => {
    const err = new Error('sessions read failed');
    const context = { requestId: 'req-1', userId: 'user-uuid', query: 'sessions' };

    reportError('ai/day-plan', err, context);

    expect(consoleError).toHaveBeenCalledWith('[ai/day-plan]', err, context);
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
