import { describe, expect, it } from 'vitest';
import { describeSessionDeletion } from '@/lib/session-delete';

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

  it('does not claim there are no laps when the lap read failed', () => {
    expect(
      describeSessionDeletion({ lapCount: null, hasOutcome: false, changeCount: 0, hasEnvironment: false }),
    ).toContain('any lap times saved with it');
  });
});
