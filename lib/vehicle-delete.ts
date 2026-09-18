/**
 * What deleting a vehicle costs the rider, and the gate in front of it.
 *
 * `sessions.vehicle_id` is `on delete cascade`, and everything hanging off a
 * session cascades from it in turn, so deleting a bike deletes every session
 * ever logged on it with their laps, outcomes and change history - plus the
 * bike's baseline, its Race Engineer recommendations and what the Race
 * Engineer has learned about it. On the free plan that is also the
 * only way to swap bikes, so a rider reaches it in an ordinary moment ("I sold
 * the R6") and the confirmation has to say, in their own numbers, what goes.
 * The delete stays off until they type the bike's nickname.
 */

export const VEHICLE_DELETE_FAILED_MESSAGE =
  'This vehicle was not deleted - something went wrong on our end. Nothing was removed, so the bike and its sessions are all still here. Try again in a moment.';

export const VEHICLE_DELETE_NOT_FOUND_MESSAGE =
  'This vehicle could not be found. It may already have been deleted - check your garage.';

export const VEHICLE_DELETE_COUNT_CHANGED_MESSAGE =
  'The sessions on this vehicle changed since this page loaded, so the numbers above are out of date. Nothing was deleted - reload the page to see what would be removed now.';

export const VEHICLE_DELETE_COUNT_FAILED_MESSAGE =
  'We could not count the sessions on this vehicle, so deleting it stays off until we can say exactly what would be removed. Reload the page to try again.';

export interface VehicleDeletionCounts {
  sessionCount: number;
  lapCount: number;
  hasBaseline: boolean;
  recommendationCount: number;
  hasRaceEngineerMemory: boolean;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What goes with the bike itself rather than with its sessions. */
function describeBikeRecords(counts: VehicleDeletionCounts): string[] {
  const records: string[] = [];
  if (counts.hasBaseline) records.push('the baseline setup you saved for it');
  if (counts.recommendationCount > 0) {
    records.push(
      plural(counts.recommendationCount, 'Race Engineer recommendation', 'Race Engineer recommendations') +
        ' made for it',
    );
  }
  if (counts.hasRaceEngineerMemory) records.push('everything the Race Engineer has learned about it');
  return records;
}

/** The sentence under the heading: what goes with the bike, counted. */
export function describeVehicleDeletion(nickname: string, counts: VehicleDeletionCounts): string {
  const records = describeBikeRecords(counts);
  const alsoRecords = records.length > 0 ? ` It also deletes ${joinList(records)}.` : '';

  if (counts.sessionCount === 0) {
    return records.length > 0
      ? `Deleting ${nickname} removes it from your garage. No sessions are logged on it.${alsoRecords} This cannot be undone.`
      : `Deleting ${nickname} removes it from your garage. No sessions are logged on it, so nothing else is lost. This cannot be undone.`;
  }

  const sessions =
    counts.sessionCount === 1
      ? 'the 1 session'
      : counts.sessionCount === 2
        ? 'both sessions'
        : `all ${plural(counts.sessionCount, 'session', 'sessions')}`;
  const laps = counts.lapCount > 0 ? ` and ${plural(counts.lapCount, 'lap time', 'lap times')}` : '';
  return `Deleting ${nickname} also deletes ${sessions} you logged on it${laps}, with their setups, notes and outcomes.${alsoRecords} This cannot be undone.`;
}

function foldNickname(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Whether what the rider typed is the bike's nickname.
 *
 * Case and spacing are folded because a phone keyboard capitalises the first
 * letter on its own; the gate is there to make the rider read the name, not to
 * fail them on autocorrect.
 */
export function nicknameConfirmationMatches(typed: string, nickname: string): boolean {
  const key = foldNickname(nickname);
  return key !== '' && foldNickname(typed) === key;
}
