import { describe, expect, it } from 'vitest';
import { checkServiceEntryDraft, describeEntryItems, draftFromStoredEntry } from '@/lib/service-book/entry-draft';
import { defaultFieldLayout, type ServiceBookField } from '@/lib/service-book/fields';

const fields: ServiceBookField[] = defaultFieldLayout().map((field, index) => ({
  id: `field-${field.builtin_key}`,
  builtin_key: field.builtin_key,
  label: field.label,
  field_type: null,
  options: null,
  enabled: field.enabled ?? true,
  required: false,
  sort_order: field.sort_order ?? index,
}));

const custom = {
  tyre: {
    id: 'field-tyre',
    builtin_key: null,
    label: 'Tyre pressure after',
    field_type: 'number' as const,
    options: null,
    enabled: true,
    required: false,
    sort_order: 80,
  },
  compound: {
    id: 'field-compound',
    builtin_key: null,
    label: 'Compound',
    field_type: 'choice' as const,
    options: ['SC1', 'SC2'],
    enabled: true,
    required: false,
    sort_order: 90,
  },
};

const items = [
  { id: 'item-oil', name: 'Engine oil and filter', archived_at: null },
  { id: 'item-pads', name: 'Brake pads', archived_at: '2026-09-01T00:00:00.000Z' },
];

const tracks = { tracks_hours: true, tracks_distance: true };

const good = {
  service_date: '2026-10-01',
  reading_hours: 41.5,
  reading_distance: null,
  performed_by: 'self',
  shop_name: '',
  cost_cents: 6850,
  notes: 'Fresh oil.',
  custom_fields: {},
  items: [{ item_id: 'item-oil', label: '' }, { item_id: null, label: ' Throttle cable ' }],
  parts: [{ brand: 'Motul', part_number: null, quantity: 3.4, unit_cost_cents: 1800 }, { brand: '', part_number: '', quantity: null, unit_cost_cents: null }],
};

describe('checkServiceEntryDraft', () => {
  it('accepts a complete entry and normalises what the rider typed', () => {
    const result = checkServiceEntryDraft(good, { fields, items, ...tracks }, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toEqual({
      service_date: '2026-10-01',
      reading_hours: 41.5,
      reading_distance: null,
      performed_by: 'self' as const,
      shop_name: null,
      cost_cents: 6850,
      notes: 'Fresh oil.',
      custom_fields: {},
      // The label of a book item is the item's own name, so a rename later does not rewrite the history.
      items: [
        { item_id: 'item-oil', label: 'Engine oil and filter' },
        { item_id: null, label: 'Throttle cable' },
      ],
      // A blank part row is the rider not adding a part.
      parts: [{ brand: 'Motul', part_number: null, quantity: 3.4, unit_cost_cents: 1800 }],
    });
  });

  it('opens with no answer for "done by" and stores none when the rider gave none', () => {
    const result = checkServiceEntryDraft({ ...good, performed_by: null }, { fields, items, ...tracks }, null);
    expect(result).toMatchObject({ ok: true, draft: { performed_by: null } });
  });

  it('refuses an entry naming nothing that was done', () => {
    expect(checkServiceEntryDraft({ ...good, items: [] }, { fields, items, ...tracks }, null)).toEqual({
      ok: false,
      error: 'Choose at least one item that was done.',
    });
  });

  it('refuses an item of another book, and accepts an archived item of this one', () => {
    expect(checkServiceEntryDraft({ ...good, items: [{ item_id: 'item-elsewhere', label: '' }] }, { fields, items, ...tracks }, null)).toEqual({
      ok: false,
      error: 'One of the items is not in this book.',
    });
    expect(checkServiceEntryDraft({ ...good, items: [{ item_id: 'item-pads', label: '' }] }, { fields, items, ...tracks }, null)).toMatchObject({
      ok: true,
      draft: { items: [{ item_id: 'item-pads', label: 'Brake pads' }] },
    });
  });

  it('refuses a required field left blank, in the rider’s own label', () => {
    const required = fields.map((field) => (field.builtin_key === 'performed_by' ? { ...field, required: true } : field));
    expect(checkServiceEntryDraft({ ...good, performed_by: null }, { fields: required, items, ...tracks }, null)).toEqual({
      ok: false,
      error: 'Choose who did the work; this book requires it.',
    });
    const tyre = { ...custom.tyre, required: true };
    expect(checkServiceEntryDraft(good, { fields: [...fields, tyre], items, ...tracks }, null)).toEqual({
      ok: false,
      error: 'Fill in Tyre pressure after; this book requires it.',
    });
  });

  it('drops a field the rider switched off rather than storing what was sent for it', () => {
    const noCost = fields.map((field) => (field.builtin_key === 'cost' ? { ...field, enabled: false } : field));
    expect(checkServiceEntryDraft(good, { fields: noCost, items, ...tracks }, null)).toMatchObject({ ok: true, draft: { cost_cents: null } });
  });

  it('keeps, on an edit, every stored value the form did not show', () => {
    const stored = {
      reading_hours: 41.5,
      reading_distance: 1240,
      performed_by: 'shop' as const,
      shop_name: 'Cresson Moto Works',
      cost_cents: 6850,
      notes: 'Fresh oil.',
      custom_fields: { 'field-tyre': 31, 'field-compound': 'SC9', 'field-gone': 'kept' },
      parts: [
        { brand: 'Motul', part_number: '104092', quantity: 1, unit_cost_cents: 1200 },
        { brand: 'Motul', part_number: '104092', quantity: 1, unit_cost_cents: 1200 },
      ],
    };
    const switchedOff = new Set(['performed_by', 'shop_name', 'cost', 'notes', 'parts']);
    const layout = [
      ...fields.map((field) => (switchedOff.has(field.builtin_key ?? '') ? { ...field, enabled: false } : field)),
      { ...custom.tyre, enabled: false },
      custom.compound,
    ];
    const sent = {
      ...good,
      reading_hours: null,
      reading_distance: 1300,
      performed_by: null,
      shop_name: null,
      cost_cents: null,
      notes: null,
      custom_fields: {},
      parts: [],
    };
    const result = checkServiceEntryDraft(sent, { fields: layout, items, tracks_hours: false, tracks_distance: true }, stored);
    expect(result).toMatchObject({
      ok: true,
      draft: {
        reading_hours: 41.5,
        reading_distance: 1300,
        performed_by: 'shop' as const,
        shop_name: 'Cresson Moto Works',
        cost_cents: 6850,
        notes: 'Fresh oil.',
        custom_fields: { 'field-tyre': 31, 'field-compound': 'SC9', 'field-gone': 'kept' },
        parts: stored.parts,
      },
    });
  });

  it('lets an edit clear or replace a stored value the form showed', () => {
    const withCustom = [...fields, custom.tyre, custom.compound];
    const stored = {
      reading_hours: 41.5,
      reading_distance: null,
      performed_by: 'self' as const,
      shop_name: null,
      cost_cents: 6850,
      notes: 'Old note.',
      custom_fields: { 'field-tyre': 31, 'field-compound': 'SC9' },
      parts: [{ brand: 'EBC', part_number: null, quantity: 2, unit_cost_cents: null }],
    };
    const sent = { ...good, cost_cents: null, notes: null, custom_fields: { 'field-compound': 'SC2' }, parts: [] };
    const result = checkServiceEntryDraft(sent, { fields: withCustom, items, ...tracks }, stored);
    expect(result).toMatchObject({ ok: true, draft: { cost_cents: null, notes: null, parts: [] } });
    if (!result.ok) return;
    expect(result.draft.custom_fields).toEqual({ 'field-compound': 'SC2' });
  });

  it('reads custom fields in their own kind and refuses the wrong one', () => {
    const withCustom = [...fields, custom.tyre, custom.compound];
    expect(
      checkServiceEntryDraft({ ...good, custom_fields: { 'field-tyre': '31.5', 'field-compound': 'SC1' } }, { fields: withCustom, items, ...tracks }, null),
    ).toMatchObject({ ok: true, draft: { custom_fields: { 'field-tyre': 31.5, 'field-compound': 'SC1' } } });
    expect(checkServiceEntryDraft({ ...good, custom_fields: { 'field-tyre': 'soft' } }, { fields: withCustom, items, ...tracks }, null)).toEqual({
      ok: false,
      error: 'Tyre pressure after has to be a number.',
    });
    expect(checkServiceEntryDraft({ ...good, custom_fields: { 'field-compound': 'SC3' } }, { fields: withCustom, items, ...tracks }, null)).toEqual({
      ok: false,
      error: 'Compound has to be one of SC1, SC2.',
    });
  });

  it('refuses a value that is not the kind its column holds', () => {
    expect(checkServiceEntryDraft({ ...good, service_date: '2026-02-30' }, { fields, items, ...tracks }, null)).toMatchObject({ ok: false });
    expect(checkServiceEntryDraft({ ...good, reading_hours: '41' }, { fields, items, ...tracks }, null)).toMatchObject({ ok: false });
    expect(checkServiceEntryDraft({ ...good, reading_hours: -1 }, { fields, items, ...tracks }, null)).toMatchObject({ ok: false });
    expect(checkServiceEntryDraft({ ...good, cost_cents: 12.5 }, { fields, items, ...tracks }, null)).toMatchObject({ ok: false });
    expect(checkServiceEntryDraft({ ...good, performed_by: 'friend' }, { fields, items, ...tracks }, null)).toMatchObject({ ok: false });
    expect(checkServiceEntryDraft('nonsense', { fields, items, ...tracks }, null)).toMatchObject({ ok: false });
  });
});

describe('draftFromStoredEntry', () => {
  it('reopens a stored entry as the draft the form edits, dropping custom values of the wrong kind', () => {
    const draft = draftFromStoredEntry(
      {
        service_date: '2026-10-01',
        reading_hours: 41.5,
        reading_distance: null,
        performed_by: 'shop' as const,
        shop_name: 'Cresson Moto Works',
        cost_cents: 24000,
        notes: null,
        custom_fields: { 'field-tyre': 31, 'field-compound': 'SC9' },
        items: [{ item_id: 'item-oil', label: 'Engine oil and filter' }],
        parts: [{ brand: 'EBC', part_number: 'FA379HH', quantity: 2, unit_cost_cents: 4200 }],
      },
      [...fields, custom.tyre, custom.compound],
    );
    expect(draft.custom_fields).toEqual({ 'field-tyre': 31 });
    expect(draft.performed_by).toBe('shop');
    expect(draft.items).toEqual([{ item_id: 'item-oil', label: 'Engine oil and filter' }]);
    expect(draft.parts).toEqual([{ brand: 'EBC', part_number: 'FA379HH', quantity: 2, unit_cost_cents: 4200 }]);
  });
});

describe('describeEntryItems', () => {
  it('joins the items as the list shows them', () => {
    expect(describeEntryItems([{ label: 'Brake pads' }, { label: 'Brake fluid' }])).toBe('Brake pads, Brake fluid');
  });
});
