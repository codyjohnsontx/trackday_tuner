import { compareSessionsDesc } from '@/lib/session-compare';
import type { Session, Vehicle } from '@/types';

/** The vehicle the dashboard hero names, and the outing its one line describes. */
export interface DashboardHeroSubject {
  /** Nickname of the vehicle to name, or null when the garage is empty. */
  vehicleName: string | null;
  /** The most recent session *that vehicle* ran, or null when it has never been out. */
  latestSession: Session | null;
}

/**
 * Which bike the hero names, and which outing it describes.
 *
 * The two come from one call because they are one claim. The card used to take
 * `vehicles[0]` - the oldest vehicle, since `getVehicles` orders by `created_at`
 * ascending - and pair it with the newest session of *any* vehicle, so a rider
 * who bought a second bike read their new bike's track day under their old
 * bike's name, with nothing on the card to say which half was wrong.
 */
export function resolveDashboardHeroSubject(
  vehicles: Vehicle[],
  sessions: Session[],
): DashboardHeroSubject {
  const fallbackName = vehicles[0]?.nickname ?? null;

  // Do not lean on the caller's ordering: every session list orders date, then
  // start_time, then created_at, and `compareSessionsDesc` is the comparator
  // that rule mirrors.
  const latestSession = [...sessions].sort(compareSessionsDesc)[0] ?? null;
  if (!latestSession) return { vehicleName: fallbackName, latestSession: null };

  const owner = vehicles.find((vehicle) => vehicle.id === latestSession.vehicle_id);
  // An unattributable session drops out rather than being described under
  // another vehicle's name - keeping the line and naming vehicles[0] is the
  // original defect. `sessions.vehicle_id` is NOT NULL and cascades from
  // `vehicles`, so this is unreachable against the database.
  if (!owner) return { vehicleName: fallbackName, latestSession: null };

  return { vehicleName: owner.nickname, latestSession };
}
