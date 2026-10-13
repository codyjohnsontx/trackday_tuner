import type { ServiceBookBuiltinField, ServiceBookFieldType, Tables, TableInsert } from '@/types/supabase';
import { isIsoDate } from '@/lib/service-book/calendar';

/**
 * The entry layout a rider shapes (owner, Q3: "fields must adapt to the rider -
 * they can add or remove entry fields to suit how they keep their book").
 *
 * A book starts with the built-in fields, each one of the entry's own columns,
 * and a rider switches off what they do not keep and adds fields of their own.
 * A field is never deleted - no API role may - only disabled, so its values stay
 * readable in the entries that hold them.
 *
 * A custom field's values live in `service_entries.custom_fields`, keyed by the
 * field's id, in a `jsonb` object nothing in the database shapes. So they are
 * read through `readCustomFieldValue`, which never throws and holds the leaf
 * rule `lib/stored-session.ts` holds for stored setups (owner, 2026-09-30): a
 * value is the field's own kind or it is not logged (`null`), and a choice is one
 * of the field's options or not logged. Text stored as a number reads as typed.
 *
 * Pure: no Supabase, no Next, so the phone app can import it.
 */

export type ServiceBookField = Pick<
  Tables<'service_book_fields'>,
  'id' | 'builtin_key' | 'label' | 'field_type' | 'options' | 'enabled' | 'required' | 'sort_order'
>;

/** A field a new book is seeded with, less the book it goes in. */
export type DefaultField = Omit<TableInsert<'service_book_fields'>, 'id' | 'book_id'> & {
  builtin_key: ServiceBookBuiltinField;
};

/** The built-ins in the order a new book shows them, with the words it shows. */
export const BUILTIN_FIELDS: readonly { key: ServiceBookBuiltinField; label: string }[] = [
  { key: 'reading', label: 'Hours / mileage reading' },
  { key: 'performed_by', label: 'Done by' },
  { key: 'shop_name', label: 'Shop' },
  { key: 'cost', label: 'Cost' },
  { key: 'parts', label: 'Parts' },
  { key: 'notes', label: 'Notes' },
  { key: 'attachments', label: 'Receipts and photos' },
];

/**
 * The layout a new book is seeded with: every built-in, switched on and
 * optional. Nothing starts required - a rider who does not know the reading
 * still logs the oil change - and the order leaves gaps of ten so a field the
 * rider adds can sit between two without renumbering the rest.
 */
export function defaultFieldLayout(): DefaultField[] {
  return BUILTIN_FIELDS.map(({ key, label }, index) => ({
    builtin_key: key,
    label,
    field_type: null,
    options: null,
    enabled: true,
    required: false,
    sort_order: (index + 1) * 10,
  }));
}

/** The fields an entry form shows, in the rider's order: enabled ones only. */
export function entryFormFields<T extends ServiceBookField>(fields: readonly T[]): T[] {
  return fields
    .filter((field) => field.enabled)
    .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A choice field's options: its distinct non-blank strings, in order. Anything else is ignored. */
export function fieldOptions(field: Pick<ServiceBookField, 'options'>): string[] {
  if (!Array.isArray(field.options)) return [];
  const options: string[] = [];
  for (const option of field.options) {
    if (typeof option !== 'string') continue;
    const trimmed = option.trim();
    if (trimmed.length > 0 && !options.includes(trimmed)) options.push(trimmed);
  }
  return options;
}

/**
 * A custom field's value, in its own kind:
 *
 * - `text`: the text as stored; a number reads as typed. Blank is not logged.
 * - `number`: a finite number, or text that is exactly one.
 * - `money`: whole cents, zero or more, as `cost_cents` stores the entry's cost.
 * - `choice`: one of the field's options, matched as the options are trimmed.
 * - `date`: a real `YYYY-MM-DD` date.
 *
 * Anything else - a value of the wrong kind, a composite, a boolean - is `null`,
 * not logged.
 */
export type CustomFieldValue = string | number | null;

export function readCustomFieldValue(
  field: Pick<ServiceBookField, 'field_type' | 'options'>,
  raw: unknown,
): CustomFieldValue {
  const type: ServiceBookFieldType | null = field.field_type;
  switch (type) {
    case 'text': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;
      return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
    }
    case 'number': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
      if (typeof raw !== 'string' || raw.trim().length === 0) return null;
      const parsed = Number(raw.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'money':
      return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;
    case 'choice': {
      if (typeof raw !== 'string') return null;
      const value = raw.trim();
      return fieldOptions(field).includes(value) ? value : null;
    }
    case 'date':
      return isIsoDate(raw) ? raw : null;
    default:
      // A built-in field has no value here; its value is one of the entry's columns.
      return null;
  }
}

/**
 * Every custom field's value on one entry, keyed by field id, whether or not the
 * field is still enabled: a field switched off later does not erase what was
 * logged in it. A `custom_fields` that is not an object reads as nothing logged.
 */
export function readCustomFields(
  fields: readonly ServiceBookField[],
  customFields: unknown,
): Record<string, CustomFieldValue> {
  const stored =
    customFields !== null && typeof customFields === 'object' && !Array.isArray(customFields)
      ? (customFields as Record<string, unknown>)
      : {};
  const values: Record<string, CustomFieldValue> = {};
  for (const field of fields) {
    if (field.builtin_key !== null) continue;
    values[field.id] = readCustomFieldValue(field, Object.prototype.hasOwnProperty.call(stored, field.id) ? stored[field.id] : undefined);
  }
  return values;
}
