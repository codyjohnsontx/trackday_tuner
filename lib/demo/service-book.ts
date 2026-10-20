import { DEMO_SESSIONS, DEMO_TELEMETRY_SUMMARIES, DEMO_VEHICLES } from '@/lib/demo/data';
import { DEMO_USER_ID } from '@/lib/demo/mode';
import type { ServiceBookData, ServiceEntryRecord, ServiceEntryRevisionRecord } from '@/lib/service-book/book-data';
import { defaultFieldLayout, type ServiceBookField } from '@/lib/service-book/fields';
import { starterItemsFor } from '@/lib/service-book/starter-items';
import type { ServiceEntryRevisionKind, Tables } from '@/types/supabase';

/**
 * The sample bike's service book, so `/demo` shows one read-only. The dates
 * sit around the demo's one track day (2026-05-18): a reading before it, an
 * oil change logged the day it was done, and an older brake job back-filled
 * weeks later and edited once - so the honest-history labels have something to
 * say. Nothing here is written anywhere; every write action refuses in demo.
 */

const DEMO_BOOK_ID = 'demo-book-r6';
const DEMO_VEHICLE_ID = 'demo-r6';
const bookCreatedAt = '2026-04-20T15:00:00.000Z';

const DEMO_BOOK: Tables<'service_books'> = {
  id: DEMO_BOOK_ID,
  vehicle_id: DEMO_VEHICLE_ID,
  tracks_hours: true,
  tracks_distance: false,
  distance_unit: 'mi',
  default_session_minutes: 20,
  default_session_distance: null,
  transferred_from_book_id: null,
  transferred_at: null,
  transferred_removed_entry_count: 0,
  owner_time_zone: null,
  created_at: bookCreatedAt,
  updated_at: bookCreatedAt,
};

const DEMO_FIELDS: ServiceBookField[] = defaultFieldLayout().map((field, index) => ({
  id: `demo-field-${field.builtin_key}`,
  builtin_key: field.builtin_key,
  label: field.label,
  field_type: null,
  options: null,
  enabled: field.builtin_key !== 'attachments' && field.enabled !== false,
  required: false,
  sort_order: field.sort_order ?? (index + 1) * 10,
}));

const INTERVALS: Record<string, Pick<Tables<'service_items'>, 'interval_hours' | 'interval_distance' | 'interval_days'>> = {
  'Engine oil and filter': { interval_hours: 15, interval_distance: null, interval_days: null },
  'Brake pads': { interval_hours: 30, interval_distance: null, interval_days: null },
  'Brake fluid': { interval_hours: null, interval_distance: null, interval_days: 365 },
  'Chain and sprockets': { interval_hours: 40, interval_distance: null, interval_days: null },
  Tires: { interval_hours: 12, interval_distance: null, interval_days: null },
};

const DEMO_ITEMS: Tables<'service_items'>[] = starterItemsFor('motorcycle').map((name, index) => ({
  id: `demo-item-${index + 1}`,
  book_id: DEMO_BOOK_ID,
  name,
  interval_hours: INTERVALS[name]?.interval_hours ?? null,
  interval_distance: INTERVALS[name]?.interval_distance ?? null,
  interval_days: INTERVALS[name]?.interval_days ?? null,
  source: 'starter',
  source_attachment_id: null,
  sort_order: (index + 1) * 10,
  archived_at: null,
  created_at: bookCreatedAt,
  updated_at: bookCreatedAt,
}));

function itemId(name: string): string {
  const item = DEMO_ITEMS.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`demo service item ${name} is not a starter item`);
  return item.id;
}

interface DemoEntrySeed {
  id: string;
  service_date: string;
  logged_at: string;
  reading_hours: number | null;
  performed_by: 'self' | 'shop' | null;
  shop_name: string | null;
  cost_cents: number | null;
  notes: string | null;
  items: string[];
  parts: Omit<Tables<'service_entry_parts'>, 'id' | 'entry_id' | 'entry_item_id' | 'created_at'>[];
  /** Edits after creation, each a `changed_at`. */
  edits: string[];
}

const SEEDS: DemoEntrySeed[] = [
  {
    id: 'demo-entry-oil',
    service_date: '2026-05-10',
    logged_at: '2026-05-10T22:10:00.000Z',
    reading_hours: 41.5,
    performed_by: 'self',
    shop_name: null,
    cost_cents: 6850,
    notes: 'Fresh oil and filter before the May track day. Drained hot, new crush washer.',
    items: ['Engine oil and filter'],
    parts: [
      { brand: 'Motul', part_number: '300V 10W-40', quantity: 3.4, unit_cost_cents: 1800 },
      { brand: 'K&N', part_number: 'KN-303', quantity: 1, unit_cost_cents: 730 },
    ],
    edits: [],
  },
  {
    id: 'demo-entry-brakes',
    service_date: '2026-04-02',
    logged_at: '2026-05-11T01:40:00.000Z',
    reading_hours: 36,
    performed_by: 'shop',
    shop_name: 'Cresson Moto Works',
    cost_cents: 24000,
    notes: 'Front pads and a fluid flush, done at the shop in April. Typed up from the invoice.',
    items: ['Brake pads', 'Brake fluid'],
    parts: [{ brand: 'EBC', part_number: 'FA379HH', quantity: 2, unit_cost_cents: 4200 }],
    edits: ['2026-05-12T14:05:00.000Z'],
  },
  {
    id: 'demo-entry-chain',
    service_date: '2026-05-17',
    logged_at: '2026-05-17T23:30:00.000Z',
    reading_hours: null,
    performed_by: 'self',
    shop_name: null,
    cost_cents: null,
    notes: 'Cleaned and lubed the chain, checked slack at 30 mm.',
    items: ['Chain and sprockets'],
    parts: [],
    edits: [],
  },
];

function snapshotOf(entry: Tables<'service_entries'>, items: Tables<'service_entry_items'>[], parts: Tables<'service_entry_parts'>[]) {
  const row: Record<string, unknown> = { ...entry };
  delete row.revision;
  delete row.updated_at;
  return {
    ...row,
    items: items.map((item) => ({ id: item.id, item_id: item.item_id, label: item.label })),
    parts: parts.map((part) => ({
      id: part.id,
      entry_item_id: part.entry_item_id,
      brand: part.brand,
      part_number: part.part_number,
      quantity: part.quantity,
      unit_cost_cents: part.unit_cost_cents,
    })),
  };
}

function buildEntry(seed: DemoEntrySeed): { record: ServiceEntryRecord; revisions: ServiceEntryRevisionRecord[] } {
  const items: Tables<'service_entry_items'>[] = seed.items.map((name, index) => ({
    id: `${seed.id}-item-${index + 1}`,
    entry_id: seed.id,
    item_id: itemId(name),
    label: name,
    created_at: seed.logged_at,
  }));
  const parts: Tables<'service_entry_parts'>[] = seed.parts.map((part, index) => ({
    id: `${seed.id}-part-${index + 1}`,
    entry_id: seed.id,
    entry_item_id: null,
    created_at: seed.logged_at,
    ...part,
  }));
  const lastChange = seed.edits[seed.edits.length - 1] ?? seed.logged_at;
  const entry: Tables<'service_entries'> = {
    id: seed.id,
    book_id: DEMO_BOOK_ID,
    service_date: seed.service_date,
    reading_hours: seed.reading_hours,
    reading_distance: null,
    performed_by: seed.performed_by,
    shop_name: seed.shop_name,
    cost_cents: seed.cost_cents,
    currency: 'USD',
    notes: seed.notes,
    custom_fields: {},
    origin: 'typed',
    logged_at: seed.logged_at,
    logged_by: DEMO_USER_ID,
    revision: seed.edits.length + 1,
    deleted_at: null,
    copied_from_entry_id: null,
    created_at: seed.logged_at,
    updated_at: lastChange,
  };
  const snapshot = snapshotOf(entry, items, parts);
  const revisions: ServiceEntryRevisionRecord[] = [
    { id: `${seed.id}-rev-1`, revision: 1, kind: 'created' as ServiceEntryRevisionKind, snapshot, changed_at: seed.logged_at },
    ...seed.edits.map((changedAt, index) => ({
      id: `${seed.id}-rev-${index + 2}`,
      revision: index + 2,
      kind: 'edited' as ServiceEntryRevisionKind,
      snapshot,
      changed_at: changedAt,
    })),
  ];
  return {
    record: {
      ...entry,
      items,
      parts,
      revisions: revisions.map(({ revision, kind, changed_at }) => ({ revision, kind, changed_at })),
      // The demo has no stored objects to sign, so its entries carry no
      // receipts: a tile that could never open would advertise a broken page.
      attachments: [],
    },
    revisions,
  };
}

const DEMO_ENTRIES = SEEDS.map(buildEntry);

/** Readings the entries wrote, as the trigger writes them, plus one the rider took off the hour meter. */
const DEMO_READINGS: Tables<'vehicle_readings'>[] = [
  {
    id: 'demo-reading-april',
    book_id: DEMO_BOOK_ID,
    reading_date: '2026-04-20',
    read_at: '2026-04-20T15:05:00.000Z',
    hours: 38.2,
    distance: null,
    source: 'rider',
    entry_id: null,
    supersedes_id: null,
    created_at: '2026-04-20T15:05:00.000Z',
    updated_at: '2026-04-20T15:05:00.000Z',
  },
  ...DEMO_ENTRIES.filter(({ record }) => record.reading_hours !== null).map(({ record }) => ({
    id: `demo-reading-${record.id}`,
    book_id: DEMO_BOOK_ID,
    reading_date: record.service_date,
    read_at: record.logged_at,
    hours: record.reading_hours,
    distance: null,
    source: 'entry' as const,
    entry_id: record.id,
    supersedes_id: null,
    created_at: record.logged_at,
    updated_at: record.logged_at,
  })),
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export interface DemoServiceBookRead {
  vehicle: Pick<Tables<'vehicles'>, 'id' | 'nickname' | 'type' | 'sold_at'>;
  data: ServiceBookData;
}

export function getDemoServiceBook(vehicleId: string): DemoServiceBookRead | null {
  const vehicle = DEMO_VEHICLES.find((candidate) => candidate.id === vehicleId);
  if (!vehicle || vehicle.id !== DEMO_VEHICLE_ID) return null;
  const summary = { id: vehicle.id, nickname: vehicle.nickname, type: vehicle.type, sold_at: vehicle.sold_at };
  const entries = DEMO_ENTRIES.map(({ record }) => record);
  const sessions = DEMO_SESSIONS.filter((session) => session.vehicle_id === vehicleId).map((session) => ({
    id: session.id,
    date: session.date,
    created_at: session.created_at,
    copied_from_session_id: session.copied_from_session_id,
  }));
  const laps = DEMO_TELEMETRY_SUMMARIES.filter((summaryRow) => sessions.some((session) => session.id === summaryRow.session_id)).flatMap(
    (summaryRow) =>
      (summaryRow.metrics.lap_times_ms ?? []).map((lapTime) => ({
        session_id: summaryRow.session_id,
        lap_time_ms: lapTime,
        included: true,
      })),
  );
  return clone({
    vehicle: summary,
    data: {
      vehicle: summary,
      book: DEMO_BOOK,
      fields: DEMO_FIELDS,
      items: DEMO_ITEMS,
      entries,
      readings: DEMO_READINGS,
      sessions,
      laps,
      weights: [],
      overrides: [],
      attachmentCount: 0,
      removedEntryCount: 0,
    },
  });
}

export function getDemoServiceEntryRevisions(entryId: string): ServiceEntryRevisionRecord[] | null {
  const entry = DEMO_ENTRIES.find(({ record }) => record.id === entryId);
  return entry ? clone(entry.revisions) : null;
}
