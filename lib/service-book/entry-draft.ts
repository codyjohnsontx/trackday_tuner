import type { ServicePerformedBy, Tables } from '@/types/supabase';
import { isIsoDate } from '@/lib/service-book/calendar';
import {
  type ServiceBookField,
  entryFormFields,
  fieldOptions,
  readCustomFieldValue,
  readCustomFields,
} from '@/lib/service-book/fields';

/**
 * What the entry form hands the save, and the rule that decides whether it may
 * be saved. The form is built from the book's own field layout (owner, Q3), so
 * the rule reads the layout too: a field switched off is not asked for, and a
 * field the rider marked required refuses a blank. An edit overwrites only what
 * the form showed: a value logged in a field switched off since, on a reading
 * axis the book no longer tracks, or that the field's current definition cannot
 * show, is carried through as it was stored.
 *
 * Three of the entry's values are answers, and a default is not one
 * (`lib/session-answers.ts`): the form opens with nothing pressed for "Done by"
 * and stores `null` until the rider says, which the column allows. The service
 * date is seeded from the rider's own calendar day (`todayLocalDate`), because
 * an evening rider west of Greenwich must not log tomorrow's service.
 *
 * Pure: no Supabase, no Next, so the phone app can share the rule.
 */

export interface ServiceEntryDraftItem {
  /** One of the book's items, or `null` for an item typed as free text. */
  item_id: string | null;
  label: string;
}

export interface ServiceEntryDraftPart {
  brand: string | null;
  part_number: string | null;
  quantity: number | null;
  unit_cost_cents: number | null;
}

/** An entry as the save receives it: every value already in its stored kind. */
export interface ServiceEntryDraft {
  service_date: string;
  reading_hours: number | null;
  reading_distance: number | null;
  performed_by: ServicePerformedBy | null;
  shop_name: string | null;
  cost_cents: number | null;
  notes: string | null;
  /** Custom field values keyed by field id, in each field's own kind. */
  custom_fields: Record<string, string | number>;
  items: ServiceEntryDraftItem[];
  parts: ServiceEntryDraftPart[];
}

export const PERFORMED_BY_OPTIONS: readonly { value: ServicePerformedBy; label: string }[] = [
  { value: 'self', label: 'Myself' },
  { value: 'shop', label: 'A shop' },
];

export function isPerformedBy(value: unknown): value is ServicePerformedBy {
  return PERFORMED_BY_OPTIONS.some((option) => option.value === value);
}

type ItemRow = Pick<Tables<'service_items'>, 'id' | 'name' | 'archived_at'>;

export type DraftCheck = { ok: true; draft: ServiceEntryDraft } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function textOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const MAX_TEXT = 2000;
const MAX_LABEL = 200;

/**
 * Checks a draft against the book it is for. Anything that is not the kind the
 * column holds is refused with a sentence the form can show, as is a required
 * field left blank, an item of another book, and an entry naming no item at
 * all - an entry has to say what was done.
 */
export function checkServiceEntryDraft(
  raw: unknown,
  book: {
    fields: readonly ServiceBookField[];
    items: readonly ItemRow[];
    tracks_hours: boolean;
    tracks_distance: boolean;
  },
  stored: StoredEntryValues | null,
): DraftCheck {
  if (!isRecord(raw)) return { ok: false, error: 'The entry could not be read.' };

  if (!isIsoDate(raw.service_date)) return { ok: false, error: 'Enter the date the work was done.' };

  const fields = entryFormFields(book.fields);
  const enabled = (key: string) => fields.some((field) => field.builtin_key === key);
  const required = (key: string) => fields.some((field) => field.builtin_key === key && field.required);

  const readingHours =
    enabled('reading') && book.tracks_hours ? finiteOrNull(raw.reading_hours) : (stored?.reading_hours ?? null);
  const readingDistance =
    enabled('reading') && book.tracks_distance ? finiteOrNull(raw.reading_distance) : (stored?.reading_distance ?? null);
  if (readingHours === undefined || readingDistance === undefined) {
    return { ok: false, error: 'The reading has to be a number.' };
  }
  if ((readingHours !== null && readingHours < 0) || (readingDistance !== null && readingDistance < 0)) {
    return { ok: false, error: 'A reading cannot be below zero.' };
  }
  if (required('reading') && readingHours === null && readingDistance === null) {
    return { ok: false, error: 'Enter the hours or mileage reading; this book requires it.' };
  }

  let performedBy: ServicePerformedBy | null = stored?.performed_by ?? null;
  if (enabled('performed_by')) {
    if (raw.performed_by !== null && raw.performed_by !== undefined && !isPerformedBy(raw.performed_by)) {
      return { ok: false, error: 'Choose who did the work.' };
    }
    performedBy = isPerformedBy(raw.performed_by) ? raw.performed_by : null;
    if (required('performed_by') && performedBy === null) {
      return { ok: false, error: 'Choose who did the work; this book requires it.' };
    }
  }

  const shopName = enabled('shop_name') ? textOrNull(raw.shop_name) : (stored?.shop_name ?? null);
  if (shopName === undefined || (shopName !== null && shopName.length > MAX_LABEL)) {
    return { ok: false, error: 'The shop name has to be text of up to 200 characters.' };
  }
  if (required('shop_name') && shopName === null) {
    return { ok: false, error: 'Enter the shop; this book requires it.' };
  }

  const costCents = enabled('cost') ? finiteOrNull(raw.cost_cents) : (stored?.cost_cents ?? null);
  if (costCents === undefined || (costCents !== null && (!Number.isInteger(costCents) || costCents < 0))) {
    return { ok: false, error: 'The cost has to be an amount of money.' };
  }
  if (required('cost') && costCents === null) {
    return { ok: false, error: 'Enter the cost; this book requires it.' };
  }

  const notes = enabled('notes') ? textOrNull(raw.notes) : (stored?.notes ?? null);
  if (notes === undefined || (notes !== null && notes.length > MAX_TEXT)) {
    return { ok: false, error: 'Notes have to be text of up to 2000 characters.' };
  }
  if (required('notes') && notes === null) {
    return { ok: false, error: 'Write a note; this book requires it.' };
  }

  const customFields: Record<string, string | number> = {};
  const storedCustom = isRecord(stored?.custom_fields) ? stored.custom_fields : {};
  for (const [fieldId, value] of Object.entries(storedCustom)) {
    const shown = fields.find((field) => field.builtin_key === null && field.id === fieldId);
    if (shown && readCustomFieldValue(shown, value) !== null) continue;
    if (typeof value === 'string' || typeof value === 'number') customFields[fieldId] = value;
  }
  const rawCustom = isRecord(raw.custom_fields) ? raw.custom_fields : {};
  for (const field of fields) {
    if (field.builtin_key !== null) continue;
    const typed = Object.prototype.hasOwnProperty.call(rawCustom, field.id) ? rawCustom[field.id] : null;
    if (typed === null || typed === undefined || typed === '') {
      if (field.required) return { ok: false, error: `Fill in ${field.label}; this book requires it.` };
      continue;
    }
    const value = readCustomFieldValue(field, typed);
    if (value === null) {
      const options = fieldOptions(field);
      const expectation =
        field.field_type === 'number'
          ? 'a number'
          : field.field_type === 'money'
            ? 'an amount of money'
            : field.field_type === 'date'
              ? 'a date'
              : field.field_type === 'choice'
                ? `one of ${options.join(', ')}`
                : 'text';
      return { ok: false, error: `${field.label} has to be ${expectation}.` };
    }
    customFields[field.id] = value;
  }

  if (!Array.isArray(raw.items)) return { ok: false, error: 'Choose at least one item that was done.' };
  const liveItems = new Map(book.items.map((item) => [item.id, item]));
  const items: ServiceEntryDraftItem[] = [];
  for (const rawItem of raw.items) {
    if (!isRecord(rawItem)) return { ok: false, error: 'An item could not be read.' };
    if (rawItem.item_id !== null && rawItem.item_id !== undefined) {
      const item = typeof rawItem.item_id === 'string' ? liveItems.get(rawItem.item_id) : undefined;
      if (!item) return { ok: false, error: 'One of the items is not in this book.' };
      if (items.some((chosen) => chosen.item_id === item.id)) continue;
      // The label is the item's name when logged, so the history reads the same after a rename.
      const logged = stored?.items.find((storedItem) => storedItem.item_id === item.id);
      items.push({ item_id: item.id, label: logged?.label ?? item.name });
      continue;
    }
    const label = textOrNull(rawItem.label);
    if (label === undefined || label === null || label.length > MAX_LABEL) {
      return { ok: false, error: 'A typed item has to be text of up to 200 characters.' };
    }
    if (items.some((chosen) => chosen.item_id === null && chosen.label === label)) continue;
    items.push({ item_id: null, label });
  }
  if (items.length === 0) return { ok: false, error: 'Choose at least one item that was done.' };

  let parts: ServiceEntryDraftPart[] = (stored?.parts ?? []).map((part) => ({
    brand: part.brand,
    part_number: part.part_number,
    quantity: part.quantity,
    unit_cost_cents: part.unit_cost_cents,
  }));
  if (enabled('parts')) {
    parts = [];
    if (!Array.isArray(raw.parts)) return { ok: false, error: 'The parts could not be read.' };
    for (const rawPart of raw.parts) {
      if (!isRecord(rawPart)) return { ok: false, error: 'A part could not be read.' };
      const brand = textOrNull(rawPart.brand);
      const partNumber = textOrNull(rawPart.part_number);
      const quantity = finiteOrNull(rawPart.quantity);
      const unitCost = finiteOrNull(rawPart.unit_cost_cents);
      if (brand === undefined || partNumber === undefined || quantity === undefined || unitCost === undefined) {
        return { ok: false, error: 'A part has to carry a brand or part number as text, and a quantity as a number.' };
      }
      if ((brand !== null && brand.length > MAX_LABEL) || (partNumber !== null && partNumber.length > MAX_LABEL)) {
        return { ok: false, error: 'A part’s brand and part number are text of up to 200 characters.' };
      }
      if (quantity !== null && quantity <= 0) return { ok: false, error: 'A part’s quantity has to be above zero.' };
      if (unitCost !== null && (!Number.isInteger(unitCost) || unitCost < 0)) {
        return { ok: false, error: 'A part’s unit cost has to be an amount of money.' };
      }
      // A row with nothing in it is the rider not adding a part.
      if (brand === null && partNumber === null && quantity === null && unitCost === null) continue;
      parts.push({ brand, part_number: partNumber, quantity, unit_cost_cents: unitCost });
    }
    if (required('parts') && parts.length === 0) {
      return { ok: false, error: 'Add at least one part; this book requires it.' };
    }
  }

  return {
    ok: true,
    draft: {
      service_date: raw.service_date,
      reading_hours: readingHours,
      reading_distance: readingDistance,
      performed_by: performedBy,
      shop_name: shopName,
      cost_cents: costCents,
      notes,
      custom_fields: customFields,
      items,
      parts,
    },
  };
}

export type StoredEntryForDraft = Pick<
  Tables<'service_entries'>,
  | 'service_date'
  | 'reading_hours'
  | 'reading_distance'
  | 'performed_by'
  | 'shop_name'
  | 'cost_cents'
  | 'notes'
  | 'custom_fields'
> & {
  items: readonly Pick<Tables<'service_entry_items'>, 'item_id' | 'label'>[];
  parts: readonly Pick<Tables<'service_entry_parts'>, 'brand' | 'part_number' | 'quantity' | 'unit_cost_cents'>[];
};

/** What an edit keeps of the stored entry wherever the form did not show a value. */
export type StoredEntryValues = Omit<StoredEntryForDraft, 'service_date'>;

/** A stored entry as the draft the edit form opens with, read by the same leaf rules the book's screens use. */
export function draftFromStoredEntry(entry: StoredEntryForDraft, fields: readonly ServiceBookField[]): ServiceEntryDraft {
  const custom: Record<string, string | number> = {};
  for (const [fieldId, value] of Object.entries(readCustomFields(fields, entry.custom_fields))) {
    if (value !== null) custom[fieldId] = value;
  }
  return {
    service_date: entry.service_date,
    reading_hours: entry.reading_hours,
    reading_distance: entry.reading_distance,
    performed_by: isPerformedBy(entry.performed_by) ? entry.performed_by : null,
    shop_name: entry.shop_name,
    cost_cents: entry.cost_cents,
    notes: entry.notes,
    custom_fields: custom,
    items: entry.items.map((item) => ({ item_id: item.item_id, label: item.label })),
    parts: entry.parts.map((part) => ({
      brand: part.brand,
      part_number: part.part_number,
      quantity: part.quantity,
      unit_cost_cents: part.unit_cost_cents,
    })),
  };
}

/** The items an entry covers as one line: `Engine oil and filter, Brake pads`. */
export function describeEntryItems(items: readonly { label: string }[]): string {
  return items.map((item) => item.label).join(', ');
}
