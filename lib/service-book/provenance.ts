import type { ServiceEntryRevisionKind, Tables } from '@/types/supabase';
import { riderDateOfTimestamp } from '@/lib/local-date';
import { daysBetween, formatDay, instantOf, monthsBetween } from '@/lib/service-book/calendar';

/**
 * The honest-history labels on a service entry (owner, Q4): what the owner's
 * book and the buyer's view say about WHEN an entry was written and whether it
 * changed since, worked out from what the server recorded rather than from
 * anything the rider typed. Back-filling old history is allowed and is never
 * hidden; it is labelled.
 *
 * | Condition                                              | Label                                          |
 * | ------------------------------------------------------ | ---------------------------------------------- |
 * | logged on the service date, in the owner's zone        | Logged the day of service                      |
 * | logged 1 to 7 days after it                            | Logged N days after service                    |
 * | logged later than that                                 | Back-filled N days / months later              |
 * | logged before the service date                         | Logged N days before the service date          |
 * | a receipt or invoice uploaded within 24 h of logging   | Receipt attached when logged                   |
 * | the first one uploaded later                           | Receipt added N days later                     |
 * | no edit                                                | Unedited                                       |
 * | edited                                                 | Edited N times, last on <date>                 |
 * | read from a photographed page                          | Read from a photographed page, confirmed by    |
 * |                                                        | the owner on <date> - and always back-filled   |
 * | came with the bike at handover                         | Logged by a previous owner, handed over on     |
 * |                                                        | <date>                                         |
 * | edited, on a copied entry                              | Edited N times by a previous owner, last on    |
 * |                                                        | <date> / Edited N times since handover         |
 *
 * EDITS ARE COUNTED FROM THE REVISION HISTORY, NEVER FROM `updated_at`. A save
 * that changes nothing is not an edit and writes no revision (20261010000100),
 * but it still moves `updated_at` - the generic trigger fires on every update,
 * and touching an entry's items touches the entry. So a label built on
 * `updated_at` would call an entry edited after a rider merely pressed Save.
 * Only `edited` revisions count: `deleted` and `restored` remove and return the
 * same content, and `transferred` is a copy. A revision number between 2 and the
 * entry's own `revision` that the caller did not pass is counted as an edit,
 * because a gap must never make an entry read cleaner than it is.
 *
 * A COPIED ENTRY CARRIES ITS HISTORY FROM BOTH SIDES OF THE HANDOVER. A bike
 * handed to a buyer brings every live entry over with its revisions and the copy
 * itself as the next revision, of kind `transferred` (20261017000600). That
 * revision is the boundary: `edited` revisions below the last one were the
 * previous owner's, above it the buyer's, and the label says which. The entry
 * is "Logged by a previous owner" whenever `copied_from_entry_id` is set - it
 * names no person, and on a bike handed over twice it does not try to count
 * owners (owner, TQ8: nothing blames one owner for another's history). The
 * handover date is the book's `transferred_at`, read in the book's own zone.
 *
 * Pure: no Supabase, no Next, so the phone app and a PDF can share the words.
 */

export type ProvenanceEntry = Pick<
  Tables<'service_entries'>,
  'service_date' | 'logged_at' | 'revision' | 'origin' | 'copied_from_entry_id'
>;
export type ProvenanceRevision = Pick<Tables<'service_entry_revisions'>, 'revision' | 'kind' | 'changed_at'>;

/**
 * An attachment as provenance needs it: its kind, and when its upload was
 * confirmed (`null` while it is still pending).
 */
export type ProvenanceAttachment = Pick<Tables<'service_attachments'>, 'kind' | 'uploaded_at'>;

export type TimingLabel =
  | { kind: 'logged_same_day'; text: string }
  | { kind: 'logged_after'; days: number; text: string }
  | { kind: 'logged_before'; days: number; text: string }
  | { kind: 'back_filled'; days: number; months: number; text: string };

export type ReceiptLabel =
  | { kind: 'receipt_when_logged'; text: string }
  | { kind: 'receipt_added_later'; days: number; text: string };

export type EditLabel =
  | { kind: 'unedited'; text: string }
  | {
      kind: 'edited';
      /** Every edit, on either side of a handover. */
      count: number;
      /** Edits below the last `transferred` revision: a previous owner's. Zero on an entry never copied. */
      beforeHandover: number;
      /** Edits above it, made since the bike was handed over - or every edit, on an entry never copied. */
      sinceHandover: number;
      lastEditedOn: string | null;
      text: string;
    };

export type OriginLabel = { kind: 'photo_draft'; confirmedOn: string; text: string };

/** The entry came with the bike: a previous owner logged it, and it was handed over on `handedOverOn`. */
export type HandoverLabel = { kind: 'previous_owner'; handedOverOn: string | null; text: string };

export interface EntryProvenance {
  timing: TimingLabel;
  receipt: ReceiptLabel | null;
  edits: EditLabel;
  origin: OriginLabel | null;
  handover: HandoverLabel | null;
  /** Every label, in the order a screen shows them. */
  labels: (TimingLabel | ReceiptLabel | EditLabel | OriginLabel | HandoverLabel)[];
}

export interface ProvenanceInput {
  entry: ProvenanceEntry;
  revisions: readonly ProvenanceRevision[];
  attachments?: readonly ProvenanceAttachment[];
  /**
   * The book's `transferred_at`: when the bike was handed to its current owner,
   * or null for a book that never was. Required, with no default, because it is
   * what dates "handed over on" on a copied entry, and a caller that forgot it
   * would print the label with no date on every copied entry.
   */
  transferredAt: string | null;
  /**
   * The book owner's IANA zone, so "the day of service" is the day of whoever
   * logged it. Always the owner's, never the viewer's or the server's: a buyer, a
   * PDF or a server render passing its own zone would relabel the same entry.
   * A missing, empty or unknown zone throws rather than falling back to UTC,
   * which would relabel the entry just the same.
   */
  timeZone: string;
}

/** Whether `timeZone` is an IANA zone this runtime's clock knows. */
export function isKnownTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function assertTimeZone(timeZone: unknown): asserts timeZone is string {
  if (isKnownTimeZone(timeZone)) return;
  throw new RangeError(`Service entry provenance needs the book owner's time zone, got ${JSON.stringify(timeZone)}`);
}

const LOGGED_AFTER_LIMIT_DAYS = 7;
const MONTHS_FROM_DAYS = 60;
const RECEIPT_WINDOW_MS = 24 * 60 * 60 * 1000;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function backFilled(days: number, months: number): TimingLabel {
  const text =
    days === 0
      ? 'Back-filled the day of service'
      : days < MONTHS_FROM_DAYS
        ? `Back-filled ${plural(days, 'day', 'days')} later`
        : `Back-filled ${plural(months, 'month', 'months')} later`;
  return { kind: 'back_filled', days, months, text };
}

function timingLabel(entry: ProvenanceEntry, loggedOn: string): TimingLabel {
  const days = daysBetween(entry.service_date, loggedOn);
  const months = days > 0 ? monthsBetween(entry.service_date, loggedOn) : 0;
  // A page read off a photo is old history typed up now, however the dates fall.
  if (entry.origin === 'photo_draft') return backFilled(Math.max(days, 0), Math.max(months, 0));
  if (days === 0) return { kind: 'logged_same_day', text: 'Logged the day of service' };
  if (days < 0) {
    const before = -days;
    return { kind: 'logged_before', days: before, text: `Logged ${plural(before, 'day', 'days')} before the service date` };
  }
  if (days <= LOGGED_AFTER_LIMIT_DAYS) {
    return { kind: 'logged_after', days, text: `Logged ${plural(days, 'day', 'days')} after service` };
  }
  return backFilled(days, months);
}

function receiptLabel(
  attachments: readonly ProvenanceAttachment[],
  loggedAt: string,
  loggedOn: string,
  timeZone: string,
): ReceiptLabel | null {
  const uploads = attachments
    .filter((attachment) => attachment.kind === 'receipt' || attachment.kind === 'invoice')
    .map((attachment) => attachment.uploaded_at)
    .filter((uploadedAt): uploadedAt is string => instantOf(uploadedAt) !== null)
    .sort((a, b) => (instantOf(a) as number) - (instantOf(b) as number));
  const first = uploads[0];
  if (first === undefined) return null;

  const logged = instantOf(loggedAt);
  if (logged === null || (instantOf(first) as number) - logged <= RECEIPT_WINDOW_MS) {
    return { kind: 'receipt_when_logged', text: 'Receipt attached when logged' };
  }
  const days = Math.max(daysBetween(loggedOn, riderDateOfTimestamp(first, timeZone)), 1);
  return { kind: 'receipt_added_later', days, text: `Receipt added ${plural(days, 'day', 'days')} later` };
}

function editLabel(
  entry: ProvenanceEntry,
  revisions: readonly ProvenanceRevision[],
  timeZone: string,
): EditLabel {
  const byNumber = new Map<number, ProvenanceRevision>();
  for (const revision of revisions) byNumber.set(revision.revision, revision);

  // The last `transferred` revision is the handover boundary. A gap is counted
  // as an edit on whichever side it falls, so a missing row never reads cleaner.
  const boundary = Math.max(0, ...revisions.filter((revision) => revision.kind === 'transferred').map((revision) => revision.revision));

  let beforeHandover = 0;
  let sinceHandover = 0;
  let lastAt: string | null = null;
  const highest = Math.max(entry.revision, ...revisions.map((revision) => revision.revision));
  for (let number = 2; number <= highest; number += 1) {
    const revision = byNumber.get(number);
    const kind: ServiceEntryRevisionKind | undefined = revision?.kind;
    if (kind !== undefined && kind !== 'edited') continue;
    if (number < boundary) beforeHandover += 1;
    else sinceHandover += 1;
    if (revision && (lastAt === null || (instantOf(revision.changed_at) ?? 0) > (instantOf(lastAt) ?? 0))) {
      lastAt = revision.changed_at;
    }
  }

  const count = beforeHandover + sinceHandover;
  if (count === 0) return { kind: 'unedited', text: 'Unedited' };
  const lastEditedOn = lastAt === null ? null : riderDateOfTimestamp(lastAt, timeZone);
  const times = (n: number) => (n === 1 ? 'once' : `${n} times`);
  const who =
    boundary === 0
      ? `Edited ${times(count)}`
      : sinceHandover === 0
        ? `Edited ${times(beforeHandover)} by a previous owner`
        : beforeHandover === 0
          ? `Edited ${times(sinceHandover)} since handover`
          : `Edited ${times(beforeHandover)} by a previous owner and ${times(sinceHandover)} since handover`;
  const text = lastEditedOn ? `${who}, last on ${formatDay(lastEditedOn)}` : who;
  return { kind: 'edited', count, beforeHandover, sinceHandover, lastEditedOn, text };
}

/**
 * Whether an entry came over at handover. Read as "carries a pointer" rather
 * than "is not null": a read that left the column out must label the entry as
 * the owner's own, never as a previous owner's - which is what the shared page
 * once did to every entry, having named its columns without this one.
 */
export function entryCameWithTheBike(entry: Pick<ProvenanceEntry, 'copied_from_entry_id'>): boolean {
  return typeof entry.copied_from_entry_id === 'string' && entry.copied_from_entry_id !== '';
}

function handoverLabel(entry: ProvenanceEntry, transferredAt: string | null, timeZone: string): HandoverLabel | null {
  if (!entryCameWithTheBike(entry)) return null;
  const handedOverOn = transferredAt !== null && instantOf(transferredAt) !== null ? riderDateOfTimestamp(transferredAt, timeZone) : null;
  return {
    kind: 'previous_owner',
    handedOverOn,
    text: handedOverOn ? `Logged by a previous owner, handed over on ${formatDay(handedOverOn)}` : 'Logged by a previous owner',
  };
}

export function describeEntryProvenance(input: ProvenanceInput): EntryProvenance {
  const { entry, timeZone } = input;
  assertTimeZone(timeZone);
  const loggedOn = riderDateOfTimestamp(entry.logged_at, timeZone);

  const timing = timingLabel(entry, loggedOn);
  const receipt = receiptLabel(input.attachments ?? [], entry.logged_at, loggedOn, timeZone);
  const edits = editLabel(entry, input.revisions, timeZone);
  const handover = handoverLabel(entry, input.transferredAt, timeZone);
  const origin: OriginLabel | null =
    entry.origin === 'photo_draft'
      ? {
          kind: 'photo_draft',
          confirmedOn: loggedOn,
          text: `Read from a photographed page, confirmed by the owner on ${formatDay(loggedOn)}`,
        }
      : null;

  const labels: EntryProvenance['labels'] = [timing];
  if (origin) labels.push(origin);
  if (handover) labels.push(handover);
  if (receipt) labels.push(receipt);
  labels.push(edits);
  return { timing, receipt, edits, origin, handover, labels };
}
