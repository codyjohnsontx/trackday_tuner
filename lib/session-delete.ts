/**
 * What deleting a session costs the rider, in their words.
 *
 * Every table that hangs off a session - laps, the outcome, the change history,
 * the weather readings, imported telemetry - is `on delete cascade`, so the one
 * delete takes all of it. A confirmation that says only "delete session" hides
 * that, so the page counts what is actually there and names it.
 */

export const SESSION_DELETE_FAILED_MESSAGE =
  'This session was not deleted - something went wrong on our end. Nothing was removed, so it is all still here. Try again in a moment.';

export const SESSION_DELETE_NOT_FOUND_MESSAGE =
  'This session could not be found. It may already have been deleted - check your sessions list.';

export const SESSION_PHOTO_BUCKET = 'session-photos';

export interface SessionDeletionContents {
  lapCount: number;
  hasOutcome: boolean;
  changeCount: number;
  hasEnvironment: boolean;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function describeSessionDeletionLosses(contents: SessionDeletionContents): string[] {
  const losses = ['the setup and notes you logged'];

  if (contents.lapCount > 0) {
    losses.push(contents.lapCount === 1 ? '1 lap time' : `${contents.lapCount} lap times`);
  }
  if (contents.hasOutcome) losses.push('the outcome you recorded');
  if (contents.changeCount > 0) losses.push('its change history');
  if (contents.hasEnvironment) losses.push('its weather readings');

  return losses;
}

export function describeSessionDeletion(contents: SessionDeletionContents): string {
  return `This also deletes ${joinList(describeSessionDeletionLosses(contents))}. It cannot be undone.`;
}

/** A read the confirmation depends on: its data, or the fact that it failed. */
type Read<T> = { ok: true; data: T } | { ok: false };

export interface SessionDeletionReads {
  laps: Read<readonly unknown[]>;
  outcome: Read<unknown | null>;
  changes: Read<readonly unknown[]>;
  environment: Read<unknown | null>;
}

export type SessionDeletionConfirmation =
  | { ok: true; description: string }
  | { ok: false; error: string };

/**
 * The confirmation for a session delete, or why there cannot be one yet.
 *
 * Each part of a session that goes with it is read separately, and a read that
 * failed is not the same as a part that is not there. Rather than confirm a list
 * that may be missing something, the delete stays off and the rider is told
 * which parts could not be loaded.
 */
export function resolveSessionDeletion(reads: SessionDeletionReads): SessionDeletionConfirmation {
  const unloaded: string[] = [];
  if (!reads.laps.ok) unloaded.push('lap times');
  if (!reads.outcome.ok) unloaded.push('outcome');
  if (!reads.changes.ok) unloaded.push('change history');
  if (!reads.environment.ok) unloaded.push('weather readings');

  if (!reads.laps.ok || !reads.outcome.ok || !reads.changes.ok || !reads.environment.ok) {
    return {
      ok: false,
      error: `We could not load this session's ${joinList(unloaded)}, so deleting it stays off until we can say exactly what would be removed. Reload the page to try again.`,
    };
  }

  return {
    ok: true,
    description: describeSessionDeletion({
      lapCount: reads.laps.data.length,
      hasOutcome: reads.outcome.data != null,
      changeCount: reads.changes.data.length,
      hasEnvironment: reads.environment.data != null,
    }),
  };
}
