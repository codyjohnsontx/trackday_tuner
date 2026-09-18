import { describe, expect, it } from 'vitest';
import { describeVehicleDeletion, nicknameConfirmationMatches } from '@/lib/vehicle-delete';

describe('describeVehicleDeletion', () => {
  it('states the sessions, laps and baseline that go with the bike', () => {
    expect(describeVehicleDeletion('Blue R6', { sessionCount: 14, lapCount: 212, hasBaseline: true })).toBe(
      'Deleting Blue R6 also deletes all 14 sessions you logged on it and 212 lap times, with their setups, notes and outcomes and the baseline setup you saved for it. This cannot be undone.',
    );
  });

  it('reads naturally for one and for two sessions', () => {
    expect(describeVehicleDeletion('Blue R6', { sessionCount: 1, lapCount: 1, hasBaseline: false })).toBe(
      'Deleting Blue R6 also deletes the 1 session you logged on it and 1 lap time, with their setups, notes and outcomes. This cannot be undone.',
    );
    expect(describeVehicleDeletion('Blue R6', { sessionCount: 2, lapCount: 0, hasBaseline: false })).toBe(
      'Deleting Blue R6 also deletes both sessions you logged on it, with their setups, notes and outcomes. This cannot be undone.',
    );
  });

  it('says plainly that nothing else goes when the bike has no sessions or baseline', () => {
    expect(describeVehicleDeletion('Blue R6', { sessionCount: 0, lapCount: 0, hasBaseline: false })).toBe(
      'Deleting Blue R6 removes it from your garage. No sessions are logged on it, so nothing else is lost. This cannot be undone.',
    );
  });

  it('still names a saved baseline on a bike with no sessions', () => {
    expect(describeVehicleDeletion('Blue R6', { sessionCount: 0, lapCount: 0, hasBaseline: true })).toBe(
      'Deleting Blue R6 removes it from your garage and the baseline setup you saved for it. No sessions are logged on it. This cannot be undone.',
    );
  });
});

describe('nicknameConfirmationMatches', () => {
  it('accepts the nickname, whatever the keyboard did to its case and spacing', () => {
    expect(nicknameConfirmationMatches('Blue R6', 'Blue R6')).toBe(true);
    expect(nicknameConfirmationMatches('  blue   r6 ', 'Blue R6')).toBe(true);
  });

  it('refuses anything else, including a prefix or nothing', () => {
    expect(nicknameConfirmationMatches('Blue', 'Blue R6')).toBe(false);
    expect(nicknameConfirmationMatches('Blue R6x', 'Blue R6')).toBe(false);
    expect(nicknameConfirmationMatches('', 'Blue R6')).toBe(false);
    expect(nicknameConfirmationMatches('', '   ')).toBe(false);
  });
});
