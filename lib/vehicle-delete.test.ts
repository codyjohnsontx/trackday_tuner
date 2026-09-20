import { describe, expect, it } from 'vitest';
import { describeVehicleDeletion, nicknameConfirmationMatches, vehiclePhotoObjectPath } from '@/lib/vehicle-delete';

describe('describeVehicleDeletion', () => {
  const none = { hasBaseline: false, recommendationCount: 0, hasRaceEngineerMemory: false };

  it('states the sessions, laps, baseline and Race Engineer history that go with the bike', () => {
    expect(
      describeVehicleDeletion('Blue R6', {
        sessionCount: 14,
        lapCount: 212,
        hasBaseline: true,
        recommendationCount: 12,
        hasRaceEngineerMemory: true,
      }),
    ).toBe(
      'Deleting Blue R6 also deletes all 14 sessions you logged on it and 212 lap times, with their setups, notes and outcomes. It also deletes the baseline setup you saved for it, 12 Race Engineer recommendations made for it and everything the Race Engineer has learned about it. This cannot be undone.',
    );
  });

  it('reads naturally for one and for two sessions', () => {
    expect(describeVehicleDeletion('Blue R6', { sessionCount: 1, lapCount: 1, ...none })).toBe(
      'Deleting Blue R6 also deletes the 1 session you logged on it and 1 lap time, with their setups, notes and outcomes. This cannot be undone.',
    );
    expect(describeVehicleDeletion('Blue R6', { sessionCount: 2, lapCount: 0, ...none })).toBe(
      'Deleting Blue R6 also deletes both sessions you logged on it, with their setups, notes and outcomes. This cannot be undone.',
    );
  });

  it('names a single Race Engineer recommendation without the baseline', () => {
    expect(
      describeVehicleDeletion('Blue R6', { sessionCount: 2, lapCount: 0, ...none, recommendationCount: 1 }),
    ).toBe(
      'Deleting Blue R6 also deletes both sessions you logged on it, with their setups, notes and outcomes. It also deletes 1 Race Engineer recommendation made for it. This cannot be undone.',
    );
  });

  it('says plainly that nothing else goes when the bike has no sessions or records', () => {
    expect(describeVehicleDeletion('Blue R6', { sessionCount: 0, lapCount: 0, ...none })).toBe(
      'Deleting Blue R6 removes it from your garage. No sessions are logged on it, so nothing else is lost. This cannot be undone.',
    );
  });

  it('still names a saved baseline and Race Engineer memory on a bike with no sessions', () => {
    expect(
      describeVehicleDeletion('Blue R6', {
        sessionCount: 0,
        lapCount: 0,
        ...none,
        hasBaseline: true,
        hasRaceEngineerMemory: true,
      }),
    ).toBe(
      'Deleting Blue R6 removes it from your garage. No sessions are logged on it. It also deletes the baseline setup you saved for it and everything the Race Engineer has learned about it. This cannot be undone.',
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

describe('vehiclePhotoObjectPath', () => {
  it('reads the object name out of the public URL the form stored', () => {
    expect(
      vehiclePhotoObjectPath('https://project.supabase.co/storage/v1/object/public/vehicle-photos/user-1/1700.jpg'),
    ).toBe('user-1/1700.jpg');
  });

  it('decodes the name the object was uploaded under', () => {
    expect(
      vehiclePhotoObjectPath(
        'http://127.0.0.1:54321/storage/v1/object/public/vehicle-photos/user-1/1700_my%20bike%20%232.jpg',
      ),
    ).toBe('user-1/1700_my bike #2.jpg');
  });

  it('finds the object under a self-hosted path prefix', () => {
    expect(
      vehiclePhotoObjectPath('https://example.com/supabase/storage/v1/object/public/vehicle-photos/user-1/a.jpg'),
    ).toBe('user-1/a.jpg');
  });

  it('answers null rather than guessing at anything else', () => {
    expect(vehiclePhotoObjectPath(null)).toBeNull();
    expect(vehiclePhotoObjectPath('')).toBeNull();
    expect(vehiclePhotoObjectPath('not a url')).toBeNull();
    expect(vehiclePhotoObjectPath('https://example.com/photos/user-1/a.jpg')).toBeNull();
    expect(vehiclePhotoObjectPath('https://project.supabase.co/storage/v1/object/public/other-bucket/a.jpg')).toBeNull();
    expect(vehiclePhotoObjectPath('https://project.supabase.co/storage/v1/object/public/vehicle-photos/')).toBeNull();
    expect(vehiclePhotoObjectPath('https://project.supabase.co/storage/v1/object/public/vehicle-photos/a%ZZ.jpg')).toBeNull();
  });
});
