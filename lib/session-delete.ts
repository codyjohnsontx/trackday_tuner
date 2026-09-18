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

export interface SessionDeletionContents {
  /** `null` when the lap read failed: the count is unknown, not zero. */
  lapCount: number | null;
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

  if (contents.lapCount === null) {
    losses.push('any lap times saved with it');
  } else if (contents.lapCount > 0) {
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
