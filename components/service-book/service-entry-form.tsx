'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/components/ui/device-value';
import { ChoiceRow } from '@/components/ui/choice-row';
import { Input } from '@/components/ui/input';
import { saveServiceEntry } from '@/lib/actions/service-book';
import { todayLocalDate } from '@/lib/local-date';
import { liveItems, type ServiceEntryRecord, type ServiceItemRow } from '@/lib/service-book/book-data';
import {
  PERFORMED_BY_OPTIONS,
  draftFromStoredEntry,
  type ServiceEntryDraft,
  type ServiceEntryDraftPart,
} from '@/lib/service-book/entry-draft';
import { entryFormFields, fieldOptions, type ServiceBookField } from '@/lib/service-book/fields';
import { moneyText, numberText, parseMoneyText, parseNumberText } from '@/lib/service-book/format';
import { cn } from '@/lib/utils';
import type { ServicePerformedBy, Tables } from '@/types/supabase';

interface ServiceEntryFormProps {
  vehicleId: string;
  book: Pick<Tables<'service_books'>, 'tracks_hours' | 'tracks_distance' | 'distance_unit'>;
  fields: ServiceBookField[];
  items: ServiceItemRow[];
  /** The entry being edited; absent for a new one. */
  entry?: ServiceEntryRecord;
}

interface PartRow {
  key: number;
  brand: string;
  partNumber: string;
  quantity: string;
  unitCost: string;
}

const EMPTY_PART = (key: number): PartRow => ({ key, brand: '', partNumber: '', quantity: '', unitCost: '' });

const selectClass =
  'flex min-h-12 w-full rounded-row bg-surface-2 px-4 py-3 text-base text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

/**
 * The entry form, built from the book's own field layout: a field the rider
 * switched off is not asked for, and one they marked required says so. The
 * date opens on the rider's own calendar day (`todayLocalDate`, after mount),
 * and "Done by" opens with nothing pressed, because a default is not an
 * answer (`lib/session-answers.ts`). The items are the book's schedule as
 * toggles plus anything typed; an entry has to name at least one.
 */
export function ServiceEntryForm({ vehicleId, book, fields, items, entry }: ServiceEntryFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEditing = entry !== undefined;
  const initial = entry ? draftFromStoredEntry(entry, fields) : null;
  const formFields = entryFormFields(fields);
  const enabled = (key: string) => formFields.some((field) => field.builtin_key === key);
  const requiredMark = (field: ServiceBookField) => (field.required ? ' (required)' : '');
  const baseId = useId();

  const [serviceDate, setServiceDate] = useState(initial?.service_date ?? '');
  const [readingHours, setReadingHours] = useState(numberText(initial?.reading_hours));
  const [readingDistance, setReadingDistance] = useState(numberText(initial?.reading_distance));
  const [performedBy, setPerformedBy] = useState<ServicePerformedBy | null>(initial?.performed_by ?? null);
  const [shopName, setShopName] = useState(initial?.shop_name ?? '');
  const [cost, setCost] = useState(moneyText(initial?.cost_cents));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [custom, setCustom] = useState<Record<string, string>>(() => {
    const values: Record<string, string> = {};
    for (const [fieldId, value] of Object.entries(initial?.custom_fields ?? {})) {
      const field = fields.find((candidate) => candidate.id === fieldId);
      values[fieldId] = field?.field_type === 'money' ? moneyText(value) : String(value);
    }
    return values;
  });
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(
    () => initial?.items.flatMap((item) => (item.item_id ? [item.item_id] : [])) ?? [],
  );
  const [typedItems, setTypedItems] = useState<string[]>(
    () => initial?.items.flatMap((item) => (item.item_id ? [] : [item.label])) ?? [],
  );
  const [otherItem, setOtherItem] = useState('');
  const [parts, setParts] = useState<PartRow[]>(() =>
    (initial?.parts ?? []).map((part, index) => ({
      key: index,
      brand: part.brand ?? '',
      partNumber: part.part_number ?? '',
      quantity: numberText(part.quantity),
      unitCost: moneyText(part.unit_cost_cents),
    })),
  );
  const [nextPartKey, setNextPartKey] = useState(parts.length);
  const [error, setError] = useState('');

  // The rider's day is only knowable in their browser, so it is seeded once
  // hydrated rather than during SSR, and only for a new entry.
  const hydrated = useHydrated();
  const [dateSeededFor, setDateSeededFor] = useState<boolean | null>(null);
  if (hydrated && dateSeededFor !== isEditing) {
    setDateSeededFor(isEditing);
    if (!isEditing && serviceDate === '') setServiceDate(todayLocalDate());
  }

  const schedule = liveItems(items);
  // An archived item the entry already names stays selectable so an edit does not drop it.
  const archivedSelected = items.filter((item) => item.archived_at !== null && selectedItemIds.includes(item.id));

  function toggleItem(itemId: string) {
    setSelectedItemIds((current) => (current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]));
  }

  function addTypedItem() {
    const label = otherItem.trim();
    if (label === '') return;
    setTypedItems((current) => (current.includes(label) ? current : [...current, label]));
    setOtherItem('');
  }

  function updatePart(key: number, change: Partial<PartRow>) {
    setParts((current) => current.map((part) => (part.key === key ? { ...part, ...change } : part)));
  }

  function buildDraft(): ServiceEntryDraft | string {
    const hours = parseNumberText(readingHours);
    const distance = parseNumberText(readingDistance);
    if (!hours.ok || !distance.ok) return 'The reading has to be a number.';
    const costCents = parseMoneyText(cost);
    if (!costCents.ok) return 'The cost has to be an amount of money, such as 68.50.';
    const pendingItem = otherItem.trim();

    const customValues: Record<string, string | number> = {};
    for (const field of formFields) {
      if (field.builtin_key !== null) continue;
      const text = (custom[field.id] ?? '').trim();
      if (text === '') continue;
      if (field.field_type === 'number') {
        const parsed = parseNumberText(text);
        if (!parsed.ok || parsed.value === null) return `${field.label} has to be a number.`;
        customValues[field.id] = parsed.value;
      } else if (field.field_type === 'money') {
        const parsed = parseMoneyText(text);
        if (!parsed.ok || parsed.value === null) return `${field.label} has to be an amount of money.`;
        customValues[field.id] = parsed.value;
      } else {
        customValues[field.id] = text;
      }
    }

    const draftParts: ServiceEntryDraftPart[] = [];
    for (const part of parts) {
      const quantity = parseNumberText(part.quantity);
      const unitCost = parseMoneyText(part.unitCost);
      if (!quantity.ok) return 'A part’s quantity has to be a number.';
      if (!unitCost.ok) return 'A part’s unit cost has to be an amount of money.';
      draftParts.push({
        brand: part.brand.trim() || null,
        part_number: part.partNumber.trim() || null,
        quantity: quantity.value,
        unit_cost_cents: unitCost.value,
      });
    }

    return {
      service_date: serviceDate,
      reading_hours: enabled('reading') && book.tracks_hours ? hours.value : null,
      reading_distance: enabled('reading') && book.tracks_distance ? distance.value : null,
      performed_by: enabled('performed_by') ? performedBy : null,
      shop_name: enabled('shop_name') ? shopName.trim() || null : null,
      cost_cents: enabled('cost') ? costCents.value : null,
      notes: enabled('notes') ? notes.trim() || null : null,
      custom_fields: customValues,
      items: [
        ...selectedItemIds.map((itemId) => ({ item_id: itemId, label: '' })),
        ...typedItems.map((label) => ({ item_id: null, label })),
        ...(pendingItem !== '' && !typedItems.includes(pendingItem) ? [{ item_id: null, label: pendingItem }] : []),
      ],
      parts: enabled('parts') ? draftParts : [],
    };
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const draft = buildDraft();
    if (typeof draft === 'string') {
      setError(draft);
      return;
    }
    if (draft.items.length === 0) {
      setError('Choose at least one item that was done, or type one.');
      return;
    }
    startTransition(async () => {
      const result = await saveServiceEntry(vehicleId, entry?.id ?? null, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/garage/${vehicleId}/book`);
      router.refresh();
    });
  }

  function renderField(field: ServiceBookField) {
    switch (field.builtin_key) {
      case 'reading':
        return (
          <div key={field.id} className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              {field.label}
              {requiredMark(field)}
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              {book.tracks_hours ? (
                <Input label="Hours" type="number" inputMode="decimal" step="any" min={0} value={readingHours} onChange={(e) => setReadingHours(e.target.value)} placeholder="41.5" />
              ) : null}
              {book.tracks_distance ? (
                <Input
                  label={`Distance (${book.distance_unit})`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  value={readingDistance}
                  onChange={(e) => setReadingDistance(e.target.value)}
                  placeholder="1240"
                />
              ) : null}
            </div>
          </div>
        );
      case 'performed_by':
        return (
          <div key={field.id} className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              {field.label}
              {requiredMark(field)}
            </span>
            <ChoiceRow label={field.label} options={PERFORMED_BY_OPTIONS} value={performedBy} clearable onChange={setPerformedBy} />
          </div>
        );
      case 'shop_name':
        return (
          <Input
            key={field.id}
            label={`${field.label}${requiredMark(field)}`}
            type="text"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="Who did the work, if a shop did"
            autoComplete="organization"
          />
        );
      case 'cost':
        return (
          <Input
            key={field.id}
            label={`${field.label} ($)${requiredMark(field)}`}
            type="text"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="68.50"
          />
        );
      case 'parts':
        return (
          <div key={field.id} className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              {field.label}
              {requiredMark(field)}
            </span>
            {parts.length === 0 ? <p className="text-sm text-ink-faint">No parts added.</p> : null}
            {parts.map((part, index) => (
              <div key={part.key} className="space-y-2 rounded-row bg-surface-2 p-3" aria-label={`Part ${index + 1}`}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input label="Brand" type="text" value={part.brand} onChange={(e) => updatePart(part.key, { brand: e.target.value })} className="bg-surface-3" />
                  <Input label="Part number" type="text" value={part.partNumber} onChange={(e) => updatePart(part.key, { partNumber: e.target.value })} className="bg-surface-3" />
                  <Input label="Quantity" type="number" inputMode="decimal" step="any" min={0} value={part.quantity} onChange={(e) => updatePart(part.key, { quantity: e.target.value })} className="bg-surface-3" />
                  <Input label="Unit cost ($)" type="text" inputMode="decimal" value={part.unitCost} onChange={(e) => updatePart(part.key, { unitCost: e.target.value })} className="bg-surface-3" />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setParts((current) => current.filter((row) => row.key !== part.key))}>
                  Remove part
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setParts((current) => [...current, EMPTY_PART(nextPartKey)]);
                setNextPartKey((key) => key + 1);
              }}
            >
              + Add part
            </Button>
          </div>
        );
      case 'notes': {
        const id = `${baseId}-notes`;
        return (
          <div key={field.id} className="space-y-2">
            <label htmlFor={id} className="block text-sm font-medium text-ink-dim">
              {field.label}
              {requiredMark(field)}
            </label>
            <textarea
              id={id}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={2000}
              className="w-full rounded-row bg-surface-2 px-4 py-3 text-base text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              placeholder="What was done, what you noticed"
            />
          </div>
        );
      }
      case 'attachments':
        // An upload is its own write, not part of Save (it writes no revision),
        // so it lives on the saved entry's page rather than in this form.
        return isEditing ? null : (
          <p key={field.id} className="text-sm text-ink-faint">
            {field.label}: add them from the entry once it is saved.
          </p>
        );
      case null:
        return renderCustomField(field);
      default:
        return null;
    }
  }

  function renderCustomField(field: ServiceBookField) {
    const value = custom[field.id] ?? '';
    const set = (text: string) => setCustom((current) => ({ ...current, [field.id]: text }));
    const label = `${field.label}${requiredMark(field)}`;
    switch (field.field_type) {
      case 'number':
        return <Input key={field.id} label={label} type="number" inputMode="decimal" step="any" value={value} onChange={(e) => set(e.target.value)} />;
      case 'money':
        return <Input key={field.id} label={`${field.label} ($)${requiredMark(field)}`} type="text" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder="0.00" />;
      case 'date':
        return <Input key={field.id} label={label} type="date" value={value} onChange={(e) => set(e.target.value)} />;
      case 'choice': {
        const id = `${baseId}-${field.id}`;
        return (
          <div key={field.id} className="space-y-2">
            <label htmlFor={id} className="block text-sm font-medium text-ink-dim">
              {label}
            </label>
            {/* Native select on purpose: Radix Select degrades on touch. The blank option is the rider not having answered. */}
            <select id={id} value={value} onChange={(e) => set(e.target.value)} className={selectClass}>
              <option value="">Not answered</option>
              {fieldOptions(field).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        );
      }
      default:
        return <Input key={field.id} label={label} type="text" value={value} onChange={(e) => set(e.target.value)} />;
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="space-y-3 rounded-card bg-surface p-4">
        <Input label="Service date" type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} required />

        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">What was done</span>
          <div role="group" aria-label="Items" className="flex flex-wrap gap-2">
            {[...schedule, ...archivedSelected].map((item) => {
              const pressed = selectedItemIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => toggleItem(item.id)}
                  className={cn(
                    'min-h-11 rounded-control px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80',
                    pressed ? 'bg-ink text-canvas' : 'bg-surface-2 text-ink-dim hover:text-ink',
                  )}
                >
                  {item.name}
                  {item.archived_at ? ' (archived)' : ''}
                </button>
              );
            })}
          </div>
          {typedItems.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Typed items">
              {typedItems.map((label) => (
                <li key={label} className="flex min-h-11 items-center gap-2 rounded-control bg-ink px-3 text-sm font-medium text-canvas">
                  {label}
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => setTypedItems((current) => current.filter((candidate) => candidate !== label))}
                    className="-mr-2 flex h-11 w-9 items-center justify-center rounded-full text-canvas/70 hover:text-canvas"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Something else"
                type="text"
                value={otherItem}
                onChange={(e) => setOtherItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTypedItem();
                  }
                }}
                placeholder="e.g. Throttle cable"
              />
            </div>
            <Button type="button" variant="secondary" onClick={addTypedItem} disabled={otherItem.trim() === ''}>
              Add
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-card bg-surface p-4">{formFields.map(renderField)}</div>

      {error ? (
        <p className="text-sm text-slower" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" fullWidth loading={isPending}>
        {isEditing ? 'Save changes' : 'Save entry'}
      </Button>
    </form>
  );
}
