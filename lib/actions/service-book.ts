'use server';

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { getDemoServiceBook, getDemoServiceEntryRevisions } from '@/lib/demo/service-book';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { reportError } from '@/lib/monitoring/report-error';
import { isUuid } from '@/lib/rag/validation';
import {
  distanceUnitLockedReason,
  holdsDistances,
  sortEntriesDesc,
  type ServiceBookData,
  type ServiceEntryRecord,
  type ServiceEntryRevisionRecord,
} from '@/lib/service-book/book-data';
import { isIsoDate } from '@/lib/service-book/calendar';
import { checkServiceEntryDraft, type ServiceEntryDraft } from '@/lib/service-book/entry-draft';
import { defaultFieldLayout, fieldOptions, type ServiceBookField } from '@/lib/service-book/fields';
import { starterItemsFor } from '@/lib/service-book/starter-items';
import { createClient } from '@/lib/supabase/server';
import type { DistanceUnit, ServiceBookFieldType, TableInsert, TableUpdate, Tables } from '@/types/supabase';
import type { ActionResult, Vehicle } from '@/types';

/**
 * The service book's server actions: every read a book screen needs, and every
 * write a rider makes to it. The honesty rules - who logged what and when,
 * edits kept as history, soft delete - live in the database (20261010000100),
 * so a write here says what the rider wants and the triggers record what
 * happened. The rules that read the book are pure modules in `lib/service-book/`
 * and run on the rider's device, where the day and the zone are known.
 *
 * A book is created lazily, from the book screen, when a bike has none yet.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type Failure = { message: string; code?: string; details?: string | null; hint?: string | null };

const NOT_AUTHENTICATED = 'Not authenticated.';
const VEHICLE_NOT_FOUND = 'Vehicle not found.';
const BOOK_NOT_FOUND = 'This bike has no service book yet.';
const ENTRY_NOT_FOUND = 'Entry not found.';
const READ_FAILED = 'The service book could not be read. Try again.';
const WRITE_FAILED = 'The service book could not be saved. Try again.';

function report(event: string, error: Failure, context: Record<string, unknown>) {
  reportError(event, new Error(error.message), { reason: error.code, details: error.details, hint: error.hint, ...context });
}

function bookPath(vehicleId: string): string {
  return `/garage/${vehicleId}/book`;
}

function revalidateBook(vehicleId: string) {
  revalidatePath(bookPath(vehicleId));
  revalidatePath('/garage');
}

async function ownVehicle(supabase: SupabaseServerClient, userId: string, vehicleId: string): Promise<Vehicle | null> {
  const { data } = await supabase.from('vehicles').select('*').eq('id', vehicleId).eq('user_id', userId).maybeSingle();
  return (data as Vehicle | null) ?? null;
}

async function ownBook(
  supabase: SupabaseServerClient,
  vehicleId: string,
): Promise<{ ok: true; book: Tables<'service_books'> | null } | { ok: false; error: Failure }> {
  const { data, error } = await supabase.from('service_books').select('*').eq('vehicle_id', vehicleId).maybeSingle();
  if (error) return { ok: false, error };
  return { ok: true, book: (data as Tables<'service_books'> | null) ?? null };
}

export interface ServiceBookRead {
  vehicle: Pick<Vehicle, 'id' | 'nickname' | 'type'>;
  /** `null` until the book is started. */
  data: ServiceBookData | null;
}

/**
 * The whole book for one of the rider's bikes. A failed read is an error, not
 * an empty book: an item shown as "never done" over a book holding its service
 * is the misreading the honest history exists to prevent.
 *
 * A removed entry is not in the book (owner, PQ6). `entryId` names the one
 * entry a page opens by its link, which is read even when removed so its
 * history stays reachable, read-only.
 */
export async function getServiceBook(
  vehicleId: string,
  options: { entryId?: string } = {},
): Promise<ActionResult<ServiceBookRead>> {
  if (await isDemoMode()) {
    const demo = getDemoServiceBook(vehicleId);
    return demo ? { ok: true, data: demo } : { ok: false, error: VEHICLE_NOT_FOUND };
  }

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const supabase = await createClient();
  const vehicle = await ownVehicle(supabase, user.id, vehicleId);
  if (!vehicle) return { ok: false, error: VEHICLE_NOT_FOUND };
  const summary = { id: vehicle.id, nickname: vehicle.nickname, type: vehicle.type };

  const bookRead = await ownBook(supabase, vehicleId);
  if (!bookRead.ok) {
    report('service-book-read', bookRead.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: READ_FAILED };
  }
  if (!bookRead.book) return { ok: true, data: { vehicle: summary, data: null } };
  const book = bookRead.book;

  const entriesQuery = supabase.from('service_entries').select('*').eq('book_id', book.id);
  const [fields, items, entries, readings, sessions, weights, overrides] = await Promise.all([
    supabase.from('service_book_fields').select('*').eq('book_id', book.id).order('sort_order'),
    supabase.from('service_items').select('*').eq('book_id', book.id).order('sort_order'),
    options.entryId !== undefined && isUuid(options.entryId)
      ? entriesQuery.or(`deleted_at.is.null,id.eq.${options.entryId}`)
      : entriesQuery.is('deleted_at', null),
    supabase.from('vehicle_readings').select('*').eq('book_id', book.id).order('reading_date'),
    supabase.from('sessions').select('id, date, created_at').eq('user_id', user.id).eq('vehicle_id', vehicleId),
    supabase.from('session_usage_weights').select('*').eq('book_id', book.id),
    supabase.from('service_due_overrides').select('*').eq('book_id', book.id),
  ]);
  for (const [table, result] of [
    ['service_book_fields', fields],
    ['service_items', items],
    ['service_entries', entries],
    ['vehicle_readings', readings],
    ['sessions', sessions],
    ['session_usage_weights', weights],
    ['service_due_overrides', overrides],
  ] as const) {
    if (result.error) {
      report('service-book-read', result.error, { table, userId: user.id, vehicleId, bookId: book.id });
      return { ok: false, error: READ_FAILED };
    }
  }

  const entryRows = (entries.data ?? []) as Tables<'service_entries'>[];
  const entryIds = entryRows.map((entry) => entry.id);
  const sessionIds = (sessions.data ?? []).map((session) => session.id);
  const [entryItems, entryParts, revisions, laps] = await Promise.all([
    entryIds.length
      ? supabase.from('service_entry_items').select('*').in('entry_id', entryIds).order('created_at')
      : Promise.resolve({ data: [] as Tables<'service_entry_items'>[], error: null }),
    entryIds.length
      ? supabase.from('service_entry_parts').select('*').in('entry_id', entryIds).order('created_at')
      : Promise.resolve({ data: [] as Tables<'service_entry_parts'>[], error: null }),
    entryIds.length
      ? supabase.from('service_entry_revisions').select('entry_id, revision, kind, changed_at').in('entry_id', entryIds).order('revision')
      : Promise.resolve({ data: [] as Pick<Tables<'service_entry_revisions'>, 'entry_id' | 'revision' | 'kind' | 'changed_at'>[], error: null }),
    sessionIds.length
      ? supabase.from('session_laps').select('session_id, lap_time_ms, included').in('session_id', sessionIds)
      : Promise.resolve({ data: [] as Pick<Tables<'session_laps'>, 'session_id' | 'lap_time_ms' | 'included'>[], error: null }),
  ]);
  for (const [table, result] of [
    ['service_entry_items', entryItems],
    ['service_entry_parts', entryParts],
    ['service_entry_revisions', revisions],
    ['session_laps', laps],
  ] as const) {
    if (result.error) {
      report('service-book-read', result.error, { table, userId: user.id, vehicleId, bookId: book.id });
      return { ok: false, error: READ_FAILED };
    }
  }

  const records: ServiceEntryRecord[] = entryRows.map((entry) => ({
    ...entry,
    items: (entryItems.data ?? []).filter((item) => item.entry_id === entry.id),
    parts: (entryParts.data ?? []).filter((part) => part.entry_id === entry.id),
    revisions: (revisions.data ?? [])
      .filter((revision) => revision.entry_id === entry.id)
      .map(({ revision, kind, changed_at }) => ({ revision, kind, changed_at })),
  }));

  return {
    ok: true,
    data: {
      vehicle: summary,
      data: {
        vehicle: summary,
        book,
        fields: (fields.data ?? []) as ServiceBookField[],
        items: (items.data ?? []) as Tables<'service_items'>[],
        entries: sortEntriesDesc(records),
        readings: (readings.data ?? []) as Tables<'vehicle_readings'>[],
        sessions: sessions.data ?? [],
        laps: laps.data ?? [],
        weights: (weights.data ?? []) as Tables<'session_usage_weights'>[],
        overrides: (overrides.data ?? []) as Tables<'service_due_overrides'>[],
      },
    },
  };
}

/** One entry's full history, snapshots included, oldest first. */
export async function getServiceEntryRevisions(
  vehicleId: string,
  entryId: string,
): Promise<ActionResult<ServiceEntryRevisionRecord[]>> {
  if (await isDemoMode()) {
    const demo = getDemoServiceBook(vehicleId);
    const revisions = demo?.data.entries.some((candidate) => candidate.id === entryId)
      ? getDemoServiceEntryRevisions(entryId)
      : null;
    return revisions ? { ok: true, data: revisions } : { ok: false, error: ENTRY_NOT_FOUND };
  }

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_entry_revisions')
    .select('id, revision, kind, snapshot, changed_at')
    .eq('entry_id', entryId)
    .order('revision');
  if (error) {
    report('service-book-read', error, { table: 'service_entry_revisions', userId: user.id, vehicleId, entryId });
    return { ok: false, error: READ_FAILED };
  }
  return { ok: true, data: (data ?? []) as ServiceEntryRevisionRecord[] };
}

/**
 * Starts a bike's book: the row, the built-in field layout, and the starter
 * items for its type. Nothing is lost if a later step fails - the book screen
 * reads whatever exists - and the rider is told to try again.
 */
export async function createServiceBook(vehicleId: string): Promise<ActionResult<{ bookId: string }>> {
  const demoError = await assertNotDemoMode<{ bookId: string }>();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const supabase = await createClient();
  const vehicle = await ownVehicle(supabase, user.id, vehicleId);
  if (!vehicle) return { ok: false, error: VEHICLE_NOT_FOUND };

  const existing = await ownBook(supabase, vehicleId);
  if (!existing.ok) {
    report('service-book-create', existing.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (existing.book) return { ok: true, data: { bookId: existing.book.id } };

  const { data: book, error: bookError } = await supabase
    .from('service_books')
    .insert({ vehicle_id: vehicleId })
    .select('id')
    .single();
  if (bookError || !book) {
    report('service-book-create', bookError ?? { message: 'insert returned no row' }, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }

  const fields: TableInsert<'service_book_fields'>[] = defaultFieldLayout().map((field) => ({ ...field, book_id: book.id }));
  const { error: fieldsError } = await supabase.from('service_book_fields').insert(fields);
  if (fieldsError) {
    report('service-book-create', fieldsError, { table: 'service_book_fields', userId: user.id, vehicleId, bookId: book.id });
    return { ok: false, error: WRITE_FAILED };
  }

  const items: TableInsert<'service_items'>[] = starterItemsFor(vehicle.type).map((name, index) => ({
    book_id: book.id,
    name,
    source: 'starter',
    sort_order: (index + 1) * 10,
  }));
  const { error: itemsError } = await supabase.from('service_items').insert(items);
  if (itemsError) {
    report('service-book-create', itemsError, { table: 'service_items', userId: user.id, vehicleId, bookId: book.id });
    return { ok: false, error: WRITE_FAILED };
  }

  revalidateBook(vehicleId);
  return { ok: true, data: { bookId: book.id } };
}

async function loadBookForWrite(
  supabase: SupabaseServerClient,
  userId: string,
  vehicleId: string,
  event: string,
): Promise<{ ok: true; book: Tables<'service_books'> } | { ok: false; error: string }> {
  const vehicle = await ownVehicle(supabase, userId, vehicleId);
  if (!vehicle) return { ok: false, error: VEHICLE_NOT_FOUND };
  const read = await ownBook(supabase, vehicleId);
  if (!read.ok) {
    report(event, read.error, { table: 'service_books', userId, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (!read.book) return { ok: false, error: BOOK_NOT_FOUND };
  return { ok: true, book: read.book };
}

/**
 * Writes an entry with its items and parts as ONE transaction, through
 * `save_service_entry` (20261013000300), so a save is one revision: a fresh
 * entry reads "Unedited" and a save that changes nothing reads as no edit.
 * Three PostgREST requests would be three transactions and three revisions,
 * which is what this replaced. The function runs as the rider, so RLS and the
 * per-column grants apply exactly as they would to the plain inserts.
 */
async function writeEntry(
  supabase: SupabaseServerClient,
  bookId: string,
  entryId: string | null,
  draft: ServiceEntryDraft,
): Promise<{ ok: true; entryId: string } | { ok: false; error: Failure; table: string }> {
  const { data, error } = await supabase.rpc('save_service_entry', {
    p_book_id: bookId,
    p_entry_id: entryId,
    p_entry: {
      service_date: draft.service_date,
      reading_hours: draft.reading_hours,
      reading_distance: draft.reading_distance,
      performed_by: draft.performed_by,
      shop_name: draft.shop_name,
      cost_cents: draft.cost_cents,
      notes: draft.notes,
      custom_fields: draft.custom_fields,
    },
    p_items: draft.items.map((item) => ({ ...item })),
    p_parts: draft.parts.map((part) => ({ ...part })),
  });
  if (error) return { ok: false, error, table: 'save_service_entry' };
  if (typeof data !== 'string') return { ok: false, error: { message: 'save_service_entry returned no id' }, table: 'save_service_entry' };
  return { ok: true, entryId: data };
}

/** Creates an entry, or edits the one `entryId` names. */
export async function saveServiceEntry(
  vehicleId: string,
  entryId: string | null,
  draft: unknown,
): Promise<ActionResult<{ entryId: string }>> {
  const demoError = await assertNotDemoMode<{ entryId: string }>();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (entryId !== null && typeof entryId !== 'string') return { ok: false, error: ENTRY_NOT_FOUND };

  const supabase = await createClient();
  const loaded = await loadBookForWrite(supabase, user.id, vehicleId, 'service-entry-save');
  if (!loaded.ok) return loaded;
  const book = loaded.book;

  const [fields, items, storedEntry, storedItems, storedParts] = await Promise.all([
    supabase.from('service_book_fields').select('*').eq('book_id', book.id),
    supabase.from('service_items').select('id, name, archived_at').eq('book_id', book.id),
    entryId === null
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from('service_entries')
          .select('reading_hours, reading_distance, performed_by, shop_name, cost_cents, notes, custom_fields')
          .eq('id', entryId)
          .eq('book_id', book.id)
          .is('deleted_at', null)
          .maybeSingle(),
    entryId === null
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('service_entry_items').select('item_id, label').eq('entry_id', entryId),
    entryId === null
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('service_entry_parts').select('brand, part_number, quantity, unit_cost_cents').eq('entry_id', entryId),
  ]);
  const readError = fields.error ?? items.error ?? storedEntry.error ?? storedItems.error ?? storedParts.error;
  if (readError) {
    report('service-entry-save', readError as Failure, { userId: user.id, vehicleId, bookId: book.id, entryId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (entryId !== null && !storedEntry.data) return { ok: false, error: ENTRY_NOT_FOUND };
  const stored = storedEntry.data ? { ...storedEntry.data, items: storedItems.data ?? [], parts: storedParts.data ?? [] } : null;

  const checked = checkServiceEntryDraft(
    draft,
    {
      fields: (fields.data ?? []) as ServiceBookField[],
      items: items.data ?? [],
      tracks_hours: book.tracks_hours,
      tracks_distance: book.tracks_distance,
    },
    stored,
  );
  if (!checked.ok) return checked;

  const written = await writeEntry(supabase, book.id, entryId, checked.draft);
  if (!written.ok) {
    if (written.error.code === 'TT404') return { ok: false, error: ENTRY_NOT_FOUND };
    report('service-entry-save', written.error, { table: written.table, userId: user.id, vehicleId, bookId: book.id, entryId });
    return { ok: false, error: WRITE_FAILED };
  }

  revalidateBook(vehicleId);
  revalidatePath(`${bookPath(vehicleId)}/entries/${written.entryId}`);
  return { ok: true, data: { entryId: written.entryId } };
}

/**
 * Removes an entry from the rider's book (owner, PQ6: soft delete). The row
 * stays, dated by the server, and its history gains a `deleted` revision; the
 * reading it carried stops counting.
 */
export async function removeServiceEntry(vehicleId: string, entryId: string): Promise<ActionResult<void>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const supabase = await createClient();
  const loaded = await loadBookForWrite(supabase, user.id, vehicleId, 'service-entry-remove');
  if (!loaded.ok) return loaded;

  const { data, error } = await supabase
    .from('service_entries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('book_id', loaded.book.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error) {
    report('service-entry-remove', error, { table: 'service_entries', userId: user.id, vehicleId, entryId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (!data) return { ok: false, error: ENTRY_NOT_FOUND };

  revalidateBook(vehicleId);
  return { ok: true, data: undefined };
}

export interface VehicleReadingInput {
  reading_date: string;
  hours: number | null;
  distance: number | null;
}

/**
 * A reading the rider took off the bike. Readings are the truth about usage
 * (owner, Q2); one is never changed, so there is no update here - a correction
 * is a new reading.
 */
export async function addVehicleReading(vehicleId: string, input: VehicleReadingInput): Promise<ActionResult<{ readingId: string }>> {
  const demoError = await assertNotDemoMode<{ readingId: string }>();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  if (!input || typeof input !== 'object' || !isIsoDate(input.reading_date)) {
    return { ok: false, error: 'Enter the date of the reading.' };
  }
  const hours = input.hours === null || input.hours === undefined ? null : input.hours;
  const distance = input.distance === null || input.distance === undefined ? null : input.distance;
  for (const value of [hours, distance]) {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      return { ok: false, error: 'A reading has to be a number of zero or more.' };
    }
  }
  if (hours === null && distance === null) return { ok: false, error: 'Enter the hours, the mileage, or both.' };

  const supabase = await createClient();
  const loaded = await loadBookForWrite(supabase, user.id, vehicleId, 'vehicle-reading-add');
  if (!loaded.ok) return loaded;

  const { data, error } = await supabase
    .from('vehicle_readings')
    .insert({ book_id: loaded.book.id, reading_date: input.reading_date, hours, distance })
    .select('id')
    .single();
  if (error || !data) {
    report('vehicle-reading-add', error ?? { message: 'insert returned no row' }, { table: 'vehicle_readings', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }

  revalidateBook(vehicleId);
  return { ok: true, data: { readingId: data.id } };
}

export interface ServiceBookSettingsInput {
  tracks_hours: boolean;
  tracks_distance: boolean;
  distance_unit: DistanceUnit;
  default_session_minutes: number;
  default_session_distance: number | null;
}

/** The book's usage defaults: which axes it tracks and what a session counts as between readings. */
export async function updateServiceBookSettings(vehicleId: string, input: ServiceBookSettingsInput): Promise<ActionResult<void>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  if (!input || typeof input !== 'object') return { ok: false, error: 'The settings could not be read.' };
  if (typeof input.tracks_hours !== 'boolean' || typeof input.tracks_distance !== 'boolean') {
    return { ok: false, error: 'Say whether the book tracks hours and mileage.' };
  }
  if (!input.tracks_hours && !input.tracks_distance) {
    return { ok: false, error: 'The book has to track hours, mileage, or both.' };
  }
  if (input.distance_unit !== 'mi' && input.distance_unit !== 'km') return { ok: false, error: 'Choose miles or kilometres.' };
  const minutes = input.default_session_minutes;
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) {
    return { ok: false, error: 'Minutes per session has to be a whole number above zero.' };
  }
  const distance = input.default_session_distance;
  if (distance !== null && (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0)) {
    return { ok: false, error: 'Distance per session has to be a number of zero or more.' };
  }

  const supabase = await createClient();
  const loaded = await loadBookForWrite(supabase, user.id, vehicleId, 'service-book-settings');
  if (!loaded.ok) return loaded;

  if (input.distance_unit !== loaded.book.distance_unit) {
    const bookId = loaded.book.id;
    const [readings, entries, items, overrides, weights] = await Promise.all([
      supabase.from('vehicle_readings').select('distance').eq('book_id', bookId).not('distance', 'is', null).limit(1),
      supabase.from('service_entries').select('reading_distance').eq('book_id', bookId).not('reading_distance', 'is', null).limit(1),
      supabase.from('service_items').select('interval_distance').eq('book_id', bookId).not('interval_distance', 'is', null).limit(1),
      supabase
        .from('service_due_overrides')
        .select('until_distance, anchor_distance')
        .eq('book_id', bookId)
        .or('until_distance.not.is.null,anchor_distance.not.is.null')
        .limit(1),
      supabase.from('session_usage_weights').select('distance_override').eq('book_id', bookId).not('distance_override', 'is', null).limit(1),
    ]);
    const readError = readings.error ?? entries.error ?? items.error ?? overrides.error ?? weights.error;
    if (readError) {
      report('service-book-settings', readError, { userId: user.id, vehicleId, bookId });
      return { ok: false, error: WRITE_FAILED };
    }
    const held = holdsDistances({
      readings: readings.data ?? [],
      entries: entries.data ?? [],
      items: items.data ?? [],
      overrides: overrides.data ?? [],
      weights: weights.data ?? [],
    });
    if (held) return { ok: false, error: distanceUnitLockedReason(loaded.book.distance_unit) };
  }

  const { error } = await supabase
    .from('service_books')
    .update({
      tracks_hours: input.tracks_hours,
      tracks_distance: input.tracks_distance,
      distance_unit: input.distance_unit,
      default_session_minutes: minutes,
      default_session_distance: distance,
    })
    .eq('id', loaded.book.id);
  if (error) {
    report('service-book-settings', error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }

  revalidateBook(vehicleId);
  revalidatePath(`${bookPath(vehicleId)}/settings`);
  return { ok: true, data: undefined };
}

export interface ServiceBookFieldInput {
  /** An existing field's id, or `null` for one the rider is adding. */
  id: string | null;
  label: string;
  /** Only read for a new field; a stored field keeps its kind. */
  field_type: ServiceBookFieldType | null;
  options: string[] | null;
  enabled: boolean;
  required: boolean;
  sort_order: number;
}

const FIELD_TYPES: readonly ServiceBookFieldType[] = ['text', 'number', 'money', 'choice', 'date'];

/**
 * The rider's entry layout (owner, Q3): built-ins switched on or off, renamed
 * and reordered; custom fields added or changed. A field is never deleted - no
 * API role may - so removing one is switching it off, and its values stay.
 */
export async function updateServiceBookFields(vehicleId: string, input: ServiceBookFieldInput[]): Promise<ActionResult<void>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (!Array.isArray(input)) return { ok: false, error: 'The fields could not be read.' };

  const supabase = await createClient();
  const loaded = await loadBookForWrite(supabase, user.id, vehicleId, 'service-book-fields');
  if (!loaded.ok) return loaded;
  const book = loaded.book;

  const { data: stored, error: readError } = await supabase.from('service_book_fields').select('*').eq('book_id', book.id);
  if (readError) {
    report('service-book-fields', readError, { table: 'service_book_fields', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }
  const storedById = new Map((stored ?? []).map((field) => [field.id, field as ServiceBookField]));

  const updates: { id: string; change: TableUpdate<'service_book_fields'> }[] = [];
  const inserts: TableInsert<'service_book_fields'>[] = [];
  for (const field of input) {
    if (!field || typeof field !== 'object') return { ok: false, error: 'A field could not be read.' };
    const label = typeof field.label === 'string' ? field.label.trim() : '';
    if (label === '' || label.length > 80) return { ok: false, error: 'Every field needs a name of up to 80 characters.' };
    if (typeof field.enabled !== 'boolean' || typeof field.required !== 'boolean' || !Number.isInteger(field.sort_order)) {
      return { ok: false, error: 'A field’s settings could not be read.' };
    }
    const options =
      field.options === null || field.options === undefined
        ? null
        : Array.isArray(field.options)
          ? fieldOptions({ options: field.options.filter((option): option is string => typeof option === 'string') })
          : undefined;
    if (options === undefined) return { ok: false, error: 'A choice field’s options have to be a list of text.' };

    if (field.id === null || field.id === undefined) {
      if (!FIELD_TYPES.includes(field.field_type as ServiceBookFieldType)) {
        return { ok: false, error: `Choose what ${label} holds: text, a number, money, a choice or a date.` };
      }
      if (field.field_type === 'choice' && (options === null || options.length === 0)) {
        return { ok: false, error: `List the choices for ${label}.` };
      }
      inserts.push({
        book_id: book.id,
        builtin_key: null,
        label,
        field_type: field.field_type,
        options: field.field_type === 'choice' ? options : null,
        enabled: field.enabled,
        required: field.required,
        sort_order: field.sort_order,
      });
      continue;
    }

    const existing = typeof field.id === 'string' ? storedById.get(field.id) : undefined;
    if (!existing) return { ok: false, error: 'One of the fields is not in this book.' };
    if (existing.field_type === 'choice' && (options === null || options.length === 0)) {
      return { ok: false, error: `List the choices for ${label}.` };
    }
    updates.push({
      id: existing.id,
      change: {
        label,
        options: existing.field_type === 'choice' ? options : existing.options,
        enabled: field.enabled,
        required: field.required,
        sort_order: field.sort_order,
      },
    });
  }

  for (const { id, change } of updates) {
    const { error } = await supabase.from('service_book_fields').update(change).eq('id', id).eq('book_id', book.id);
    if (error) {
      report('service-book-fields', error, { table: 'service_book_fields', userId: user.id, vehicleId, fieldId: id });
      return { ok: false, error: WRITE_FAILED };
    }
  }
  if (inserts.length > 0) {
    const { error } = await supabase.from('service_book_fields').insert(inserts);
    if (error) {
      report('service-book-fields', error, { table: 'service_book_fields', userId: user.id, vehicleId });
      return { ok: false, error: WRITE_FAILED };
    }
  }

  revalidateBook(vehicleId);
  revalidatePath(`${bookPath(vehicleId)}/settings`);
  revalidatePath(`${bookPath(vehicleId)}/entries/new`);
  return { ok: true, data: undefined };
}

export interface ServiceItemInput {
  id: string | null;
  name: string;
  interval_hours: number | null;
  interval_distance: number | null;
  interval_days: number | null;
  archived: boolean;
}

function positiveOrNull(value: unknown, whole = false): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  if (whole && !Number.isInteger(value)) return undefined;
  return value;
}

/**
 * One item of the schedule: its name and the intervals the rider typed. An
 * interval is the rider's or the manual's to state, never a default (see
 * `starter-items.ts`). An item is archived rather than deleted, because entries
 * name it.
 */
export async function saveServiceItem(vehicleId: string, input: ServiceItemInput): Promise<ActionResult<{ itemId: string }>> {
  const demoError = await assertNotDemoMode<{ itemId: string }>();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (!input || typeof input !== 'object') return { ok: false, error: 'The item could not be read.' };

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name === '' || name.length > 120) return { ok: false, error: 'An item needs a name of up to 120 characters.' };
  const hours = positiveOrNull(input.interval_hours);
  const distance = positiveOrNull(input.interval_distance);
  const days = positiveOrNull(input.interval_days, true);
  if (hours === undefined || distance === undefined || days === undefined) {
    return { ok: false, error: 'An interval has to be a number above zero, and days a whole number.' };
  }
  if (typeof input.archived !== 'boolean') return { ok: false, error: 'The item could not be read.' };

  const supabase = await createClient();
  const loaded = await loadBookForWrite(supabase, user.id, vehicleId, 'service-item-save');
  if (!loaded.ok) return loaded;
  const book = loaded.book;

  if (input.id === null || input.id === undefined) {
    const { data: last } = await supabase
      .from('service_items')
      .select('sort_order')
      .eq('book_id', book.id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await supabase
      .from('service_items')
      .insert({
        book_id: book.id,
        name,
        interval_hours: hours,
        interval_distance: distance,
        interval_days: days,
        source: 'typed',
        sort_order: (last?.sort_order ?? 0) + 10,
        archived_at: input.archived ? new Date().toISOString() : null,
      })
      .select('id')
      .single();
    if (error || !data) {
      report('service-item-save', error ?? { message: 'insert returned no row' }, { table: 'service_items', userId: user.id, vehicleId });
      return { ok: false, error: WRITE_FAILED };
    }
    revalidateBook(vehicleId);
    revalidatePath(`${bookPath(vehicleId)}/settings`);
    return { ok: true, data: { itemId: data.id } };
  }

  if (typeof input.id !== 'string') return { ok: false, error: 'Item not found.' };
  const { data: current, error: currentError } = await supabase
    .from('service_items')
    .select('id, archived_at')
    .eq('id', input.id)
    .eq('book_id', book.id)
    .maybeSingle();
  if (currentError) {
    report('service-item-save', currentError, { table: 'service_items', userId: user.id, vehicleId, itemId: input.id });
    return { ok: false, error: WRITE_FAILED };
  }
  if (!current) return { ok: false, error: 'Item not found.' };

  const { error } = await supabase
    .from('service_items')
    .update({
      name,
      interval_hours: hours,
      interval_distance: distance,
      interval_days: days,
      archived_at: input.archived ? (current.archived_at ?? new Date().toISOString()) : null,
    })
    .eq('id', current.id)
    .eq('book_id', book.id);
  if (error) {
    report('service-item-save', error, { table: 'service_items', userId: user.id, vehicleId, itemId: current.id });
    return { ok: false, error: WRITE_FAILED };
  }

  revalidateBook(vehicleId);
  revalidatePath(`${bookPath(vehicleId)}/settings`);
  return { ok: true, data: { itemId: current.id } };
}
