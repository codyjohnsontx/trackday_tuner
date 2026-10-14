import type { DistanceUnit, Tables } from '@/types/supabase';
import type { DueOverride, ItemDue } from '@/lib/service-book/due';
import type { ServiceBookField } from '@/lib/service-book/fields';
import { describeEntryProvenance, type EntryProvenance, type ProvenanceRevision } from '@/lib/service-book/provenance';
import { computeBookDue } from '@/lib/service-book/reminders';
import { computeUsage, type BookUsage, type UsageInput, type UsageLap, type UsageSession, type UsageWeight } from '@/lib/service-book/usage';

/**
 * A bike's whole service book as its screens receive it, and the one way the
 * rules are run over it. The rows are read on the server; the rules run where
 * the rider is, because two of their inputs exist only there: today's date in
 * the rider's own calendar (`todayLocalDate`) and the book owner's time zone,
 * which the app stores nowhere and which, on the owner's own screens, is the
 * zone of the browser looking at them.
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
};

/** One row of an entry's history, snapshot included, as the entry page lists it. */
export type ServiceEntryRevisionRecord = Pick<
  Tables<'service_entry_revisions'>,
  'id' | 'revision' | 'kind' | 'snapshot' | 'changed_at'
>;

export interface ServiceBookData {
  vehicle: Pick<Tables<'vehicles'>, 'id' | 'nickname' | 'type'>;
  book: ServiceBookRow;
  fields: ServiceBookField[];
  items: ServiceItemRow[];
  /** Live entries, plus the one removed entry a caller names by `entryId`. */
  entries: ServiceEntryRecord[];
  readings: VehicleReadingRow[];
  sessions: UsageSession[];
  laps: UsageLap[];
  weights: UsageWeight[];
  overrides: DueOverride[];
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
}

export function buildServiceBookView(
  data: ServiceBookData,
  clock: { today: string; timeZone: string },
): ServiceBookView {
  const usageInput = usageInputOf(data);
  // The same call the dashboard chips and the session banner make
  // (`lib/service-book/reminders.ts`), so a chip and the schedule agree.
  const due = computeBookDue(data, clock);
  const provenanceByEntryId = new Map<string, EntryProvenance>();
  for (const entry of data.entries) {
    provenanceByEntryId.set(
      entry.id,
      describeEntryProvenance({ entry, revisions: entry.revisions, timeZone: clock.timeZone }),
    );
  }
  return {
    usage: computeUsage(usageInput),
    due,
    dueByItemId: new Map(due.map((item) => [item.itemId, item])),
    provenanceByEntryId,
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
