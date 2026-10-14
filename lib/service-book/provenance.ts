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
 * Pure: no Supabase, no Next, so the phone app and a PDF can share the words.
 */

export type ProvenanceEntry = Pick<Tables<'service_entries'>, 'service_date' | 'logged_at' | 'revision' | 'origin'>;
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
  | { kind: 'edited'; count: number; lastEditedOn: string | null; text: string };

export type OriginLabel = { kind: 'photo_draft'; confirmedOn: string; text: string };

export interface EntryProvenance {
  timing: TimingLabel;
  receipt: ReceiptLabel | null;
  edits: EditLabel;
  origin: OriginLabel | null;
  /** Every label, in the order a screen shows them. */
  labels: (TimingLabel | ReceiptLabel | EditLabel | OriginLabel)[];
}

export interface ProvenanceInput {
  entry: ProvenanceEntry;
  revisions: readonly ProvenanceRevision[];
  attachments?: readonly ProvenanceAttachment[];
  /**
   * The book owner's IANA zone, so "the day of service" is the day of whoever
   * logged it. Always the owner's, never the viewer's or the server's: a buyer, a
   * PDF or a server render passing its own zone would relabel the same entry.
   * A missing, empty or unknown zone throws rather than falling back to UTC,
   * which would relabel the entry just the same.
   */
  timeZone: string;
}

function assertTimeZone(timeZone: unknown): asserts timeZone is string {
  if (typeof timeZone === 'string' && timeZone !== '') {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return;
    } catch {
      // Falls through to the error below.
    }
  }
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

  let count = 0;
  let lastAt: string | null = null;
  const highest = Math.max(entry.revision, ...revisions.map((revision) => revision.revision));
  for (let number = 2; number <= highest; number += 1) {
    const revision = byNumber.get(number);
    const kind: ServiceEntryRevisionKind | undefined = revision?.kind;
    if (kind !== undefined && kind !== 'edited') continue;
    count += 1;
    if (revision && (lastAt === null || (instantOf(revision.changed_at) ?? 0) > (instantOf(lastAt) ?? 0))) {
      lastAt = revision.changed_at;
    }
  }

  if (count === 0) return { kind: 'unedited', text: 'Unedited' };
  const lastEditedOn = lastAt === null ? null : riderDateOfTimestamp(lastAt, timeZone);
  const times = count === 1 ? 'once' : `${count} times`;
  const text = lastEditedOn ? `Edited ${times}, last on ${formatDay(lastEditedOn)}` : `Edited ${times}`;
  return { kind: 'edited', count, lastEditedOn, text };
}

export function describeEntryProvenance(input: ProvenanceInput): EntryProvenance {
  const { entry, timeZone } = input;
  assertTimeZone(timeZone);
  const loggedOn = riderDateOfTimestamp(entry.logged_at, timeZone);

  const timing = timingLabel(entry, loggedOn);
  const receipt = receiptLabel(input.attachments ?? [], entry.logged_at, loggedOn, timeZone);
  const edits = editLabel(entry, input.revisions, timeZone);
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
  if (receipt) labels.push(receipt);
  labels.push(edits);
  return { timing, receipt, edits, origin, labels };
}
