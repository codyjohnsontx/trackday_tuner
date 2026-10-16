import type { DistanceUnit, Tables } from '@/types/supabase';
import { liveItems, sortEntriesDesc, type ServiceEntryRecord, type ServiceEntryAttachment, type ServiceItemRow } from '@/lib/service-book/book-data';
import { formatDay } from '@/lib/service-book/calendar';
import { describeEntryItems } from '@/lib/service-book/entry-draft';
import { readCustomFields, type ServiceBookField } from '@/lib/service-book/fields';
import { formatDistance, formatHours, formatInterval, formatMoney, formatServiceDate } from '@/lib/service-book/format';
import { describeEntryProvenance, isKnownTimeZone } from '@/lib/service-book/provenance';
import { latestReading, type UsageReading } from '@/lib/service-book/usage';

/**
 * What anyone holding a share link reads of a bike's service book (owner, Q5),
 * built from the rows the share page loads. It is the one place that decides
 * what leaves the owner's account through a link, so a page or a later PDF
 * prints this and never a row: no rider id, no email, no session, and nothing of
 * a removed entry but the count (owner, PQ6).
 *
 * THE LABELS ARE READ IN THE OWNER'S ZONE, NEVER THE VIEWER'S (owner, Q4). "Logged
 * the day of service" is the day of whoever logged it, so a buyer in another zone
 * reads what the owner reads. The zone is the book's `owner_time_zone`; when it
 * is missing or one this clock does not know, the entries carry no labels and
 * the view says so, rather than labelling them in some other zone.
 *
 * Pure: no Supabase, no Next, so a PDF and the phone app can print the same.
 */

export interface SharedBookInput {
  vehicle: Pick<Tables<'vehicles'>, 'nickname' | 'type' | 'year' | 'make' | 'model'>;
  book: Pick<Tables<'service_books'>, 'distance_unit' | 'owner_time_zone'>;
  fields: ServiceBookField[];
  items: ServiceItemRow[];
  /** Every entry of the book, removed ones included: those are counted, never shown. */
  entries: ServiceEntryRecord[];
  readings: UsageReading[];
}

export interface SharedReading {
  value: string;
  on: string;
}

export interface SharedItem {
  id: string;
  name: string;
  interval: string | null;
  /** The latest service date of an entry naming it, or null when none does. */
  lastDone: string | null;
}

export interface SharedEntry {
  id: string;
  serviceDate: string;
  title: string;
  details: { label: string; value: string }[];
  parts: string[];
  notes: string | null;
  /** The honest-history labels; empty when the owner's zone is unknown. */
  labels: string[];
  attachments: ServiceEntryAttachment[];
}

export interface SharedBookView {
  title: string;
  /** Year, make and model, when the owner logged any of them. */
  subtitle: string | null;
  readings: SharedReading[];
  items: SharedItem[];
  entries: SharedEntry[];
  /** Entries the owner removed: the line "N entries removed by the owner". */
  removedCount: number;
  /** Whether the entries carry their labels, which needs the owner's zone. */
  labelled: boolean;
}

export function describeRemovedEntries(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'entry' : 'entries'} removed by the owner`;
}

function readingsOf(readings: readonly UsageReading[], unit: DistanceUnit): SharedReading[] {
  const shown: SharedReading[] = [];
  const hours = latestReading(readings, 'hours');
  const hoursText = hours ? formatHours(hours.hours) : null;
  if (hours && hoursText) shown.push({ value: hoursText, on: formatDay(hours.reading_date) });
  const distance = latestReading(readings, 'distance');
  const distanceText = distance ? formatDistance(distance.distance, unit) : null;
  if (distance && distanceText) shown.push({ value: distanceText, on: formatDay(distance.reading_date) });
  return shown;
}

function entryDetails(entry: ServiceEntryRecord, fields: readonly ServiceBookField[], unit: DistanceUnit): SharedEntry['details'] {
  const details: SharedEntry['details'] = [];
  const add = (label: string, value: string | null) => {
    if (value !== null && value !== '') details.push({ label, value });
  };
  add('Hours', formatHours(entry.reading_hours));
  add('Distance', formatDistance(entry.reading_distance, unit));
  add('Done by', entry.performed_by === 'self' ? 'The owner' : entry.performed_by === 'shop' ? 'A shop' : null);
  add('Shop', entry.performed_by === 'shop' ? entry.shop_name : null);
  add('Cost', formatMoney(entry.cost_cents, entry.currency));
  const customValues = readCustomFields(fields, entry.custom_fields);
  for (const field of fields) {
    const value = field.builtin_key === null ? customValues[field.id] : null;
    if (value === null || value === undefined) continue;
    add(field.label, field.field_type === 'money' ? formatMoney(value) : field.field_type === 'date' ? formatServiceDate(value) : String(value));
  }
  return details;
}

function partText(part: ServiceEntryRecord['parts'][number]): string {
  const name = [part.brand, part.part_number].filter(Boolean).join(' ') || 'Part';
  const quantity = part.quantity !== null ? ` × ${part.quantity}` : '';
  const cost = formatMoney(part.unit_cost_cents);
  return `${name}${quantity}${cost ? ` · ${cost} each` : ''}`;
}

export function buildSharedBookView(input: SharedBookInput): SharedBookView {
  const unit = input.book.distance_unit;
  const timeZone = isKnownTimeZone(input.book.owner_time_zone) ? input.book.owner_time_zone : null;
  const live = sortEntriesDesc(input.entries.filter((entry) => entry.deleted_at === null));

  const lastDoneByItem = new Map<string, string>();
  for (const entry of live) {
    for (const item of entry.items) {
      if (item.item_id === null) continue;
      const seen = lastDoneByItem.get(item.item_id);
      if (seen === undefined || entry.service_date > seen) lastDoneByItem.set(item.item_id, entry.service_date);
    }
  }

  const subtitle = [input.vehicle.year, input.vehicle.make, input.vehicle.model]
    .filter((part) => part !== null && String(part).trim() !== '')
    .join(' ');

  return {
    title: input.vehicle.nickname,
    subtitle: subtitle === '' ? null : subtitle,
    readings: readingsOf(input.readings, unit),
    items: liveItems(input.items).map((item) => {
      const lastDone = lastDoneByItem.get(item.id);
      return { id: item.id, name: item.name, interval: formatInterval(item, unit), lastDone: lastDone ? formatDay(lastDone) : null };
    }),
    entries: live.map((entry) => ({
      id: entry.id,
      serviceDate: formatServiceDate(entry.service_date),
      title: describeEntryItems(entry.items) || 'Service',
      details: entryDetails(entry, input.fields, unit),
      parts: entry.parts.map(partText),
      notes: entry.notes && entry.notes.trim() !== '' ? entry.notes : null,
      labels: timeZone
        ? describeEntryProvenance({ entry, revisions: entry.revisions, attachments: entry.attachments, timeZone }).labels.map((label) => label.text)
        : [],
      attachments: entry.attachments,
    })),
    removedCount: input.entries.length - live.length,
    labelled: timeZone !== null,
  };
}
