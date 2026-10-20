import type { DistanceUnit, Tables } from '@/types/supabase';
import { riderDateOfTimestamp } from '@/lib/local-date';
import { formatDay, instantOf } from '@/lib/service-book/calendar';
import type { DueOverride, ItemDue } from '@/lib/service-book/due';
import type { ServiceBookField } from '@/lib/service-book/fields';
import {
  describeEntryProvenance,
  entryCameWithTheBike,
  isKnownTimeZone,
  type EntryProvenance,
  type ProvenanceAttachment,
  type ProvenanceRevision,
} from '@/lib/service-book/provenance';
import { computeBookDue } from '@/lib/service-book/reminders';
import { computeUsage, type BookUsage, type UsageInput, type UsageLap, type UsageSession, type UsageWeight } from '@/lib/service-book/usage';

/**
 * A bike's whole service book as its screens receive it, and the one way the
 * rules are run over it. The rows are read on the server; the rules run where
 * the rider is, because two of their inputs exist only there: today's date in
 * the rider's own calendar (`todayLocalDate`) and their browser's zone. An
 * entry's honest-history labels are the exception: they are read in the book's
 * pinned `owner_time_zone`, as a shared copy reads them (shared-view.ts), and in
 * the browser's zone only until one is pinned (`ownerLabelTimeZone`).
 *
 * Pure: no Supabase, no Next, so the phone app can build the same screens.
 */

export type ServiceBookRow = Tables<'service_books'>;
export type ServiceItemRow = Tables<'service_items'>;
export type VehicleReadingRow = Tables<'vehicle_readings'>;

/** An entry with everything its row owns. */
export type ServiceEntryRecord = Tables<'service_entries'> & {
  items: Tables<'service_entry_items'>[];
  parts: Tables<'service_entry_parts'>[];
  /** Its history, newest last; `snapshot` is left out of the list read. */
  revisions: ProvenanceRevision[];
  /** Its confirmed receipts, invoices and photos; a pending upload is not one yet. */
  attachments: ServiceEntryAttachment[];
};

/** An attachment as the book reads it. Its object is reached only through a signed URL. */
export type ServiceEntryAttachment = Pick<
  Tables<'service_attachments'>,
  'id' | 'entry_id' | 'kind' | 'mime' | 'bytes' | 'uploaded_at' | 'created_at'
> &
  ProvenanceAttachment;

/** One row of an entry's history, snapshot included, as the entry page lists it. */
export type ServiceEntryRevisionRecord = Pick<
  Tables<'service_entry_revisions'>,
  'id' | 'revision' | 'kind' | 'snapshot' | 'changed_at'
>;

/**
 * A session as the book reads it: what the usage rules need, and whether it
 * came with the bike at handover (`copied_from_session_id`, 20261017000600),
 * which the received-book banner counts and nothing follows.
 */
export type ServiceBookSession = UsageSession & Pick<Tables<'sessions'>, 'copied_from_session_id'>;

export interface ServiceBookData {
  vehicle: Pick<Tables<'vehicles'>, 'id' | 'nickname' | 'type'>;
  book: ServiceBookRow;
  fields: ServiceBookField[];
  items: ServiceItemRow[];
  /** Live entries, plus the one removed entry a caller names by `entryId`. */
  entries: ServiceEntryRecord[];
  readings: VehicleReadingRow[];
  sessions: ServiceBookSession[];
  laps: UsageLap[];
  weights: UsageWeight[];
  overrides: DueOverride[];
  /**
   * How many attachments the book's allowance counts: every confirmed one, and
   * every reservation younger than a day, the count reserve_service_attachment
   * makes (20261014000400).
   */
  attachmentCount: number;
  /** How many of the book's entries are removed: counted, never read (owner, PQ6). */
  removedEntryCount: number;
}

export function usageInputOf(data: ServiceBookData): UsageInput {
  return {
    book: data.book,
    readings: data.readings,
    sessions: data.sessions,
    laps: data.laps,
    weights: data.weights,
  };
}

/**
 * The rules run once over the book, with the rider's own day and zone. Every
 * screen reads from this rather than calling a rule itself, so the due chip on
 * an item and the usage line above it cannot be computed from two different
 * inputs.
 */
export interface ServiceBookView {
  usage: BookUsage;
  due: ItemDue[];
  dueByItemId: Map<string, ItemDue>;
  provenanceByEntryId: Map<string, EntryProvenance>;
  /** What the book came with, when it was handed to this owner; null on a book that was not. */
  handover: ReceivedHistory | null;
}

/**
 * The banner on a book a buyer received (owner, PQ2): when it was handed over,
 * in the same zone the entries' labels are read in, and how much of the history
 * that came with it is here now - counted off the rows' own `copied_from_*`
 * pointers, never by following one to the previous owner's data. Nothing
 * records the counts as handed over, and a session is deleted outright, so the
 * banner says what is present rather than what arrived.
 */
export interface ReceivedHistory {
  /** The handover day, formatted. */
  handedOverOn: string;
  /** Entries a previous owner logged that are still in the book. */
  entries: number;
  /** Sessions that came with the bike and are still on it. */
  sessions: number;
  /** "N entries removed by an owner", across every owner, or null when none was. */
  removedEntries: string | null;
}

/** The line a book prints for its removed entries, across every owner (owner, TQ8). */
export function describeRemovedEntries(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'entry' : 'entries'} removed by an owner`;
}

export function describeReceivedHistory(
  data: Pick<ServiceBookData, 'book' | 'entries' | 'sessions' | 'removedEntryCount'>,
  labelZone: string,
): ReceivedHistory | null {
  const transferredAt = data.book.transferred_at;
  if (transferredAt === null || instantOf(transferredAt) === null) return null;
  return {
    handedOverOn: formatDay(riderDateOfTimestamp(transferredAt, labelZone)),
    entries: data.entries.filter((entry) => entryCameWithTheBike(entry) && entry.deleted_at === null).length,
    sessions: data.sessions.filter((session) => typeof session.copied_from_session_id === 'string' && session.copied_from_session_id !== '').length,
    removedEntries: describeRemovedEntries(data.book.transferred_removed_entry_count + data.removedEntryCount),
  };
}

/**
 * The zone the owner's own screens label entries in: the book's pinned zone, so
 * the owner reads what a buyer reads and no label moves without an edit (owner,
 * 2026-10-16), and the browser's only while none this clock reads is pinned.
 */
export function ownerLabelTimeZone(ownerTimeZone: string | null, browserTimeZone: string): string {
  return isKnownTimeZone(ownerTimeZone) ? ownerTimeZone : browserTimeZone;
}

export function buildServiceBookView(
  data: ServiceBookData,
  clock: { today: string; timeZone: string },
): ServiceBookView {
  const usageInput = usageInputOf(data);
  // The same call the dashboard chips and the session banner make
  // (`lib/service-book/reminders.ts`), so a chip and the schedule agree.
  const due = computeBookDue(data, clock);
  const labelZone = ownerLabelTimeZone(data.book.owner_time_zone, clock.timeZone);
  const provenanceByEntryId = new Map<string, EntryProvenance>();
  for (const entry of data.entries) {
    provenanceByEntryId.set(
      entry.id,
      describeEntryProvenance({
        entry,
        revisions: entry.revisions,
        attachments: entry.attachments,
        transferredAt: data.book.transferred_at,
        timeZone: labelZone,
      }),
    );
  }
  return {
    usage: computeUsage(usageInput),
    due,
    dueByItemId: new Map(due.map((item) => [item.itemId, item])),
    provenanceByEntryId,
    handover: describeReceivedHistory(data, labelZone),
  };
}

export function distanceUnitLockedReason(unit: DistanceUnit): string {
  const name = unit === 'km' ? 'kilometres' : 'miles';
  return `This book already holds distances in ${name}, so its unit stays ${name}. Switching would relabel them without converting.`;
}

/** Live items in the rider's order; archived ones stay out of every list. */
export function liveItems(items: readonly ServiceItemRow[]): ServiceItemRow[] {
  return items
    .filter((item) => item.archived_at === null)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** Entries newest first: by service date, then by when they were logged. */
export function sortEntriesDesc<T extends Pick<Tables<'service_entries'>, 'service_date' | 'logged_at'>>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.service_date !== b.service_date) return a.service_date < b.service_date ? 1 : -1;
    return a.logged_at < b.logged_at ? 1 : a.logged_at > b.logged_at ? -1 : 0;
  });
}
