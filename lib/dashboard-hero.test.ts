// The dashboard hero names one vehicle and describes one outing, and the two
// have to be the same vehicle's. It used to take `vehicles[0]` - the oldest
// vehicle, since getVehicles orders by created_at ascending - and pair it with
// the newest session of *any* vehicle, so a rider who bought a second bike read
// their new bike's track day under their old bike's name. Nothing on the card
// said which one was wrong.
import { describe, expect, it } from 'vitest';
import { resolveDashboardHeroSubject } from '@/lib/dashboard-hero';
import type { Session, Vehicle } from '@/types';

function vehicle(id: string, nickname: string, createdAt: string): Vehicle {
  return {
    id,
    user_id: 'user-1',
    nickname,
    type: 'motorcycle',
    year: null,
    make: null,
    model: null,
    photo_url: null,
    created_at: createdAt,
    updated_at: createdAt,
  } as Vehicle;
}

function session(overrides: Partial<Session> & Pick<Session, 'id' | 'vehicle_id' | 'date'>): Session {
  return {
    user_id: 'user-1',
    track_id: null,
    track_name: 'MSR Cresson 1.7',
    start_time: null,
    session_number: null,
    conditions: 'sunny',
    tires: {},
    suspension: {},
    alignment: null,
    enabled_modules: null,
    extra_modules: null,
    notes: null,
    created_at: `${overrides.date}T00:00:00Z`,
    updated_at: `${overrides.date}T00:00:00Z`,
    ...overrides,
  } as Session;
}

// A rider whose old bike is still in the garage and whose new bike is the one
// they have been riding. `getVehicles` returns them oldest first.
const oldBike = vehicle('veh-old', 'Old CBR', '2026-08-01T12:00:00Z');
const newBike = vehicle('veh-new', 'New R6', '2026-08-10T12:00:00Z');
const garage = [oldBike, newBike];

const oldBikeOuting = session({ id: 's-old', vehicle_id: 'veh-old', date: '2026-08-11', start_time: '09:00:00' });
const newBikeOuting = session({ id: 's-new', vehicle_id: 'veh-new', date: '2026-08-18', start_time: '14:20:00' });

describe('dashboard hero subject', () => {
  it('names the vehicle that ran the most recent session, not the oldest vehicle', () => {
    const subject = resolveDashboardHeroSubject(garage, [newBikeOuting, oldBikeOuting]);

    expect(subject.vehicleName).toBe('New R6');
    expect(subject.latestSession?.id).toBe('s-new');
  });

  it('never describes an outing under another vehicle name', () => {
    const subject = resolveDashboardHeroSubject(garage, [newBikeOuting, oldBikeOuting]);

    const named = garage.find((item) => item.nickname === subject.vehicleName);
    expect(named?.id).toBe(subject.latestSession?.vehicle_id);
  });

  it('picks the newest session even when the caller hands them over in another order', () => {
    // getSessions is ordered, but the hero must not be the thing that depends on it.
    const subject = resolveDashboardHeroSubject(garage, [oldBikeOuting, newBikeOuting]);

    expect(subject.vehicleName).toBe('New R6');
    expect(subject.latestSession?.id).toBe('s-new');
  });

  it('breaks a same-day tie the way every other list does', () => {
    const morning = session({ id: 's-morning', vehicle_id: 'veh-old', date: '2026-08-18', start_time: '08:40:00' });
    const afternoon = session({ id: 's-afternoon', vehicle_id: 'veh-new', date: '2026-08-18', start_time: '14:20:00' });

    const subject = resolveDashboardHeroSubject(garage, [morning, afternoon]);

    expect(subject.latestSession?.id).toBe('s-afternoon');
    expect(subject.vehicleName).toBe('New R6');
  });

  it('falls back to the first vehicle before anything has been logged', () => {
    const subject = resolveDashboardHeroSubject(garage, []);

    expect(subject.vehicleName).toBe('Old CBR');
    expect(subject.latestSession).toBeNull();
  });

  it('names nothing when the garage is empty', () => {
    expect(resolveDashboardHeroSubject([], [])).toEqual({ vehicleName: null, latestSession: null });
  });

  it('drops the outing rather than attribute it to a vehicle that is not there', () => {
    // sessions.vehicle_id is NOT NULL and cascades from vehicles, so this cannot
    // happen against the database. It is pinned because the alternative - keeping
    // the line and naming vehicles[0] - is the original defect written down again.
    const orphan = session({ id: 's-orphan', vehicle_id: 'veh-gone', date: '2026-08-20' });

    const subject = resolveDashboardHeroSubject(garage, [orphan]);

    expect(subject.latestSession).toBeNull();
    expect(subject.vehicleName).toBe('Old CBR');
  });
});
