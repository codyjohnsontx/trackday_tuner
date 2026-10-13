import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FIELDS,
  defaultFieldLayout,
  entryFormFields,
  fieldOptions,
  readCustomFields,
  readCustomFieldValue,
  type ServiceBookField,
} from '@/lib/service-book/fields';
import type { ServiceBookBuiltinField } from '@/types/supabase';

function field(extra: Partial<ServiceBookField> = {}): ServiceBookField {
  return {
    id: 'f',
    builtin_key: null,
    label: 'Torque wrench',
    field_type: 'text',
    options: null,
    enabled: true,
    required: false,
    sort_order: 0,
    ...extra,
  };
}

describe('the default layout', () => {
  it('seeds every built-in the schema allows, once, switched on and optional', () => {
    const layout = defaultFieldLayout();
    // The check constraint on service_book_fields.builtin_key, 20261010000100.
    const schemaKeys: ServiceBookBuiltinField[] = ['reading', 'performed_by', 'shop_name', 'cost', 'parts', 'notes', 'attachments'];
    expect(layout.map((row) => row.builtin_key).sort()).toEqual([...schemaKeys].sort());
    for (const row of layout) {
      // service_book_fields_type_matches_kind: a built-in carries no field_type.
      expect(row).toMatchObject({ field_type: null, options: null, enabled: true, required: false });
      expect(row.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('orders them with room to put a rider field between any two', () => {
    const orders = defaultFieldLayout().map((row) => row.sort_order);
    expect(orders).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(defaultFieldLayout().map((row) => row.builtin_key)).toEqual(BUILTIN_FIELDS.map((row) => row.key));
  });
});

describe('the entry form', () => {
  it('shows enabled fields in the rider order', () => {
    const fields = [
      field({ id: 'c', sort_order: 30 }),
      field({ id: 'off', sort_order: 5, enabled: false }),
      field({ id: 'a', sort_order: 10 }),
      field({ id: 'b', sort_order: 10 }),
    ];
    expect(entryFormFields(fields).map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('choice options', () => {
  it('keeps distinct non-blank strings and drops the rest', () => {
    expect(fieldOptions({ options: [' Motul ', 'Motul', '', 3, null, 'Shell'] })).toEqual(['Motul', 'Shell']);
    expect(fieldOptions({ options: { a: 1 } })).toEqual([]);
    expect(fieldOptions({ options: null })).toEqual([]);
  });
});

describe('a custom field value', () => {
  it('text: as stored, a number as typed, blank or anything else not logged', () => {
    const text = field({ field_type: 'text' });
    expect(readCustomFieldValue(text, ' 25 Nm ')).toBe(' 25 Nm ');
    expect(readCustomFieldValue(text, 25)).toBe('25');
    expect(readCustomFieldValue(text, '   ')).toBeNull();
    expect(readCustomFieldValue(text, true)).toBeNull();
    expect(readCustomFieldValue(text, { a: 1 })).toBeNull();
    expect(readCustomFieldValue(text, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('number: a finite number, or text that is exactly one', () => {
    const number = field({ field_type: 'number' });
    expect(readCustomFieldValue(number, 2.5)).toBe(2.5);
    expect(readCustomFieldValue(number, ' 2.5 ')).toBe(2.5);
    expect(readCustomFieldValue(number, '2.5 quarts')).toBeNull();
    expect(readCustomFieldValue(number, '')).toBeNull();
    expect(readCustomFieldValue(number, Number.NaN)).toBeNull();
  });

  it('money: whole cents, zero or more', () => {
    const money = field({ field_type: 'money' });
    expect(readCustomFieldValue(money, 4599)).toBe(4599);
    expect(readCustomFieldValue(money, 0)).toBe(0);
    expect(readCustomFieldValue(money, 45.99)).toBeNull();
    expect(readCustomFieldValue(money, -1)).toBeNull();
    expect(readCustomFieldValue(money, '4599')).toBeNull();
  });

  it('choice: one of its options, or not logged - never a default', () => {
    const choice = field({ field_type: 'choice', options: ['Dealer', 'Track-side'] });
    expect(readCustomFieldValue(choice, 'Dealer')).toBe('Dealer');
    expect(readCustomFieldValue(choice, ' Dealer ')).toBe('Dealer');
    expect(readCustomFieldValue(choice, 'Garage')).toBeNull();
    expect(readCustomFieldValue(choice, null)).toBeNull();
  });

  it('date: a real calendar date', () => {
    const date = field({ field_type: 'date' });
    expect(readCustomFieldValue(date, '2026-09-20')).toBe('2026-09-20');
    expect(readCustomFieldValue(date, '2026-02-30')).toBeNull();
    expect(readCustomFieldValue(date, '20/09/2026')).toBeNull();
    expect(readCustomFieldValue(date, 20260920)).toBeNull();
  });
});

describe('every custom value on an entry', () => {
  const fields = [
    field({ id: 'torque', field_type: 'number' }),
    field({ id: 'gone', field_type: 'text', enabled: false }),
    field({ id: 'notes', builtin_key: 'notes', field_type: null, label: 'Notes' }),
  ];

  it('reads each custom field by id, keeping values in fields switched off since', () => {
    expect(readCustomFields(fields, { torque: 25, gone: 'still here', stray: 'x' })).toEqual({ torque: 25, gone: 'still here' });
  });

  it('reads a missing value, or a custom_fields that is not an object, as nothing logged', () => {
    expect(readCustomFields(fields, {})).toEqual({ torque: null, gone: null });
    for (const stored of [null, [], 'text', 7]) {
      expect(readCustomFields(fields, stored)).toEqual({ torque: null, gone: null });
    }
  });

  it('does not read a key inherited from the prototype', () => {
    expect(readCustomFields([field({ id: 'toString', field_type: 'text' })], {})).toEqual({ toString: null });
  });
});
