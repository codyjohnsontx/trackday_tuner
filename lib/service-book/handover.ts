import type { Tables } from '@/types/supabase';
import { liveItems, type ServiceBookData, type ServiceBookView } from '@/lib/service-book/book-data';
import { numberText } from '@/lib/service-book/format';

/**
 * The seller's side of handing a bike to a buyer (owner, PQ2; TQ1 to TQ9):
 * what the handover screen says goes over, what the seller keeps, and what the
 * garage card and the book say while a link is out.
 *
 * The counts are read off the SAME rows the book screen renders
 * (`ServiceBookData`, plus three figures the book does not load), so the
 * handover screen cannot describe a bike differently from the book beside it -
 * the rule `describeVehicleDeletion` already applies to the delete
 * confirmation. `create_service_book_transfer` (20261017000600) stores its own
 * counts from the same tables at the moment the link is made; these are what
 * the seller read before pressing the button.
 *
 * Pure: no Supabase, no Next, so the phone app can show the same screen.
 */

/** How long a handover link lasts (owner, TQ4): the default `expires_at` the row takes. */
export const HANDOVER_LINK_DAYS = 14;

export interface HandoverCounts {
  entries: number;
  /** Entries whose honest-history label reads back-filled. */
  backFilled: number;
  /** Entries the seller has edited since logging them. */
  edited: number;
  itemsWithIntervals: number;
  /** The rider's own readings, and ones carried over by an earlier handover; never an entry's. */
  readings: number;
  attachments: number;
  attachmentBytes: number;
  sessions: number;
  laps: number;
  sessionPhotos: number;
  outcomes: number;
  overrides: number;
  weights: number;
  /** Removed entries, this owner's and every earlier owner's (TQ8): counted on the copy, never shown. */
  removedEntries: number;
}

/** The three figures the book screen never loads, read beside it for this screen. */
export interface HandoverExtraCounts {
  sessionPhotos: number;
  outcomes: number;
  /** The seller's own removed entries; the book row carries the earlier owners'. */
  removedEntries: number;
}

/**
 * The counts, from the book's own read and the rules already run over it. The
 * view is required rather than optional because two of the counts are labels
 * (`back_filled`, `edited`) that exist only once the rider's clock is read.
 */
export function countHandover(data: ServiceBookData, view: ServiceBookView, extra: HandoverExtraCounts): HandoverCounts {
  const entries = data.entries.filter((entry) => entry.deleted_at === null);
  let backFilled = 0;
  let edited = 0;
  for (const entry of entries) {
    const provenance = view.provenanceByEntryId.get(entry.id);
    if (!provenance) continue;
    if (provenance.timing.kind === 'back_filled') backFilled += 1;
    if (provenance.edits.kind === 'edited') edited += 1;
  }
  const attachments = entries.flatMap((entry) => entry.attachments);
  return {
    entries: entries.length,
    backFilled,
    edited,
    itemsWithIntervals: liveItems(data.items).filter(
      (item) => item.interval_hours !== null || item.interval_distance !== null || item.interval_days !== null,
    ).length,
    readings: data.readings.filter((reading) => reading.source === 'rider' || reading.source === 'transfer').length,
    attachments: attachments.length,
    attachmentBytes: attachments.reduce((total, attachment) => total + attachment.bytes, 0),
    sessions: data.sessions.length,
    laps: data.laps.length,
    sessionPhotos: extra.sessionPhotos,
    outcomes: extra.outcomes,
    overrides: data.overrides.length,
    weights: data.weights.length,
    removedEntries: data.book.transferred_removed_entry_count + extra.removedEntries,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "about 3.2 MB" from a byte count, to one decimal below 100 MB. */
export function describeMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 0.05) return 'under 0.1 MB';
  return `about ${megabytes < 100 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

export interface HandoverDescription {
  /** What the buyer's copy holds, one line per kind of record. */
  goesOver: string[];
  /** The exclusion column: what the copy never carries (TQ5, and the plan's table). */
  staysWithYou: string;
  /** The seller's own copy after accept. */
  youKeep: string;
  /** The one-line receipt warning (TQ6); absent when nothing is attached. */
  receiptsWarning: string | null;
}

/** The handover screen's words, from the counts. */
export function describeHandover(counts: HandoverCounts): HandoverDescription {
  const goesOver: string[] = [];

  const entryDetail =
    counts.backFilled > 0 || counts.edited > 0
      ? ` (${[counts.backFilled > 0 ? `${counts.backFilled} back-filled` : null, counts.edited > 0 ? `${counts.edited} edited` : null]
          .filter((part): part is string => part !== null)
          .join(', ')})`
      : '';
  goesOver.push(
    `Your service book: ${plural(counts.entries, 'entry', 'entries')}${entryDetail}, ${plural(counts.itemsWithIntervals, 'item', 'items')} with intervals, ${plural(counts.readings, 'reading', 'readings')}, ${plural(counts.attachments, 'receipt or photo', 'receipts and photos')}${counts.attachments > 0 ? ` (${describeMegabytes(counts.attachmentBytes)})` : ''}`,
  );
  goesOver.push(
    `Your track sessions on this bike: ${plural(counts.sessions, 'session', 'sessions')}, ${plural(counts.laps, 'lap time', 'lap times')}, ${plural(counts.sessionPhotos, 'photo', 'photos')}, ${plural(counts.outcomes, 'outcome note', 'outcome notes')}`,
  );
  goesOver.push(`Your snoozes and adjustments: ${counts.overrides}`);
  goesOver.push(`${plural(counts.weights, 'session', 'sessions')} you weighted`);
  if (counts.removedEntries > 0) {
    goesOver.push(`${plural(counts.removedEntries, 'removed entry is', 'removed entries are')} counted, not shown`);
  }

  return {
    goesOver,
    staysWithYou:
      'What stays with you only: your Race Engineer advice and what it has learned about this bike, your saved baseline setup, and your AI questions.',
    youKeep:
      'What you keep: a read-only copy of everything above, as it stands the moment the buyer accepts. Anything either of you adds afterwards is yours alone.',
    receiptsWarning:
      counts.attachments > 0
        ? 'Receipts and photos go over exactly as you uploaded them, so remove any that show details you would rather keep before you hand over.'
        : null,
  };
}

/**
 * The reading the handover form opens with: the book's current usage, rounded
 * as the usage panel prints it (hours to a tenth, distance whole), as text the
 * rider can correct. An axis the book only estimates - no reading at all, just
 * sessions counted from zero - is left blank: a closing reading written on
 * both books should start from something the rider read off the bike.
 */
export function handoverReadingDefaults(view: ServiceBookView): { hours: string; distance: string } {
  const prefill = (axis: { current: number | null; basis: string } | null) =>
    axis && axis.basis !== 'none' && axis.basis !== 'estimate_only' ? axis.current : null;
  const hours = prefill(view.usage.hours);
  const distance = prefill(view.usage.distance);
  return {
    hours: hours === null ? '' : numberText(Math.round(hours * 10) / 10),
    distance: distance === null ? '' : numberText(Math.round(distance)),
  };
}

export type ServiceBookHandoverRow = Pick<
  Tables<'service_book_transfers'>,
  'id' | 'book_id' | 'to_email_normalized' | 'status' | 'expires_at' | 'handover_hours' | 'handover_distance' | 'created_at'
>;

export type HandoverState =
  | { kind: 'pending'; daysLeft: number; text: string }
  | { kind: 'expired'; text: string };

/** Whole days from `now` until the link expires, rounded up so "1 day" means some of today is left. */
export function daysUntil(expiresAt: string, now: Date): number {
  const expires = new Date(expiresAt).getTime();
  if (Number.isNaN(expires)) return 0;
  // `Math.max` folds the -0 a just-expired link would round to.
  return Math.max(0, Math.ceil((expires - now.getTime()) / (24 * 60 * 60 * 1000)));
}

/**
 * What the garage card and the book say about a pending link. Expiry is read
 * off `expires_at` against the rider's clock; an expired link is still the
 * book's one pending handover until it is cancelled (TQ4), which is why the
 * expired state is offered the same Cancel.
 */
export function describeHandoverState(handover: Pick<ServiceBookHandoverRow, 'status' | 'expires_at'>, now: Date): HandoverState | null {
  if (handover.status !== 'pending') return null;
  const daysLeft = daysUntil(handover.expires_at, now);
  if (daysLeft <= 0) return { kind: 'expired', text: 'Link expired - send a new one' };
  return { kind: 'pending', daysLeft, text: `Handover pending - link expires in ${plural(daysLeft, 'day', 'days')}` };
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;

/** The address as the database stores and compares it. */
export function normalizeHandoverEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isHandoverEmailShape(email: string): boolean {
  return EMAIL_SHAPE.test(normalizeHandoverEmail(email));
}

/** The sold banner on the seller's book. The date is the rider's own calendar day of the sale. */
export function describeSoldBook(soldOn: string | null): string {
  return soldOn
    ? `Handed over on ${soldOn}. This is your copy of the history up to then, and it no longer changes.`
    : 'Handed over. This is your copy of the history up to then, and it no longer changes.';
}
