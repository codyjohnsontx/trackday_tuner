import { describe, expect, it } from 'vitest';
import { describeSessionDeletion, resolveSessionDeletion } from '@/lib/session-delete';

describe('describeSessionDeletion', () => {
  it('names every piece of a session that goes with it', () => {
    expect(
      describeSessionDeletion({ lapCount: 12, hasOutcome: true, changeCount: 2, hasEnvironment: true }),
    ).toBe(
      'This also deletes the setup and notes you logged, 12 lap times, the outcome you recorded, its change history and its weather readings. It cannot be undone.',
    );
  });

  it('names only what is there', () => {
    expect(
      describeSessionDeletion({ lapCount: 0, hasOutcome: false, changeCount: 0, hasEnvironment: false }),
    ).toBe('This also deletes the setup and notes you logged. It cannot be undone.');
  });

  it('counts a single lap in the singular', () => {
    expect(
      describeSessionDeletion({ lapCount: 1, hasOutcome: false, changeCount: 0, hasEnvironment: false }),
    ).toBe('This also deletes the setup and notes you logged and 1 lap time. It cannot be undone.');
  });

});

describe('resolveSessionDeletion', () => {
  const loaded = {
    laps: { ok: true as const, data: [{}, {}] },
    outcome: { ok: true as const, data: { id: 'outcome-1' } },
    changes: { ok: true as const, data: [] },
    environment: { ok: true as const, data: null },
  };

  it('confirms with the counted losses when every read succeeded', () => {
    expect(resolveSessionDeletion(loaded)).toEqual({
      ok: true,
      description:
        'This also deletes the setup and notes you logged, 2 lap times and the outcome you recorded. It cannot be undone.',
    });
  });

  it('refuses to confirm, naming the part that could not be loaded', () => {
    expect(resolveSessionDeletion({ ...loaded, outcome: { ok: false } })).toEqual({
      ok: false,
      error:
        "We could not load this session's outcome, so deleting it stays off until we can say exactly what would be removed. Reload the page to try again.",
    });
  });

  it('names every part that failed, including laps', () => {
    const result = resolveSessionDeletion({
      laps: { ok: false },
      outcome: loaded.outcome,
      changes: { ok: false },
      environment: { ok: false },
    });

    expect(result).toEqual({
      ok: false,
      error:
        "We could not load this session's lap times, change history and weather readings, so deleting it stays off until we can say exactly what would be removed. Reload the page to try again.",
    });
  });
});
