'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardGroup, Eyebrow, GroupRow } from '@/components/ui/surface';
import {
  saveServiceItem,
  updateServiceBookFields,
  updateServiceBookSettings,
  type ServiceBookFieldInput,
} from '@/lib/actions/service-book';
import { distanceUnitLockedReason, type ServiceItemRow } from '@/lib/service-book/book-data';
import { fieldOptions, type ServiceBookField } from '@/lib/service-book/fields';
import { numberText, parseNumberText } from '@/lib/service-book/format';
import { cn } from '@/lib/utils';
import type { DistanceUnit, ServiceBookFieldType, Tables } from '@/types/supabase';

interface ServiceBookSettingsProps {
  vehicleId: string;
  book: Tables<'service_books'>;
  fields: ServiceBookField[];
  items: ServiceItemRow[];
  /** The book holds distances, so its unit cannot change (`getServiceBookUnitLocked`). */
  unitLocked: boolean;
}

const selectClass =
  'flex min-h-12 w-full rounded-row bg-surface-2 px-4 py-3 text-base text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

const checkboxClass = 'h-5 w-5 rounded-plate accent-signal';

/** The book's settings: what a session counts as, the entry layout, and the schedule. */
export function ServiceBookSettings({ vehicleId, book, fields, items, unitLocked }: ServiceBookSettingsProps) {
  return (
    <div className="space-y-5">
      <UsageDefaults vehicleId={vehicleId} book={book} unitLocked={unitLocked} />
      <FieldLayout vehicleId={vehicleId} fields={fields} />
      <Schedule vehicleId={vehicleId} items={items} unit={book.distance_unit} />
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (next: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-row bg-surface-2 px-4 py-2">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint ? <span className="block text-xs text-ink-faint">{hint}</span> : null}
      </span>
      <input id={id} type="checkbox" className={checkboxClass} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function UsageDefaults({ vehicleId, book, unitLocked }: { vehicleId: string; book: Tables<'service_books'>; unitLocked: boolean }) {
  const router = useRouter();
  const [tracksHours, setTracksHours] = useState(book.tracks_hours);
  const [tracksDistance, setTracksDistance] = useState(book.tracks_distance);
  const [unit, setUnit] = useState<DistanceUnit>(book.distance_unit);
  const [minutes, setMinutes] = useState(String(book.default_session_minutes));
  const [distance, setDistance] = useState(numberText(book.default_session_distance));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const unitId = useId();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaved(false);
    const parsedMinutes = parseNumberText(minutes);
    const parsedDistance = parseNumberText(distance);
    if (!parsedMinutes.ok || parsedMinutes.value === null || !Number.isInteger(parsedMinutes.value) || parsedMinutes.value <= 0) {
      setError('Minutes per session has to be a whole number above zero.');
      return;
    }
    if (!parsedDistance.ok) {
      setError('Distance per session has to be a number.');
      return;
    }
    startTransition(async () => {
      const result = await updateServiceBookSettings(vehicleId, {
        tracks_hours: tracksHours,
        tracks_distance: tracksDistance,
        distance_unit: unit,
        default_session_minutes: parsedMinutes.value as number,
        default_session_distance: tracksDistance ? parsedDistance.value : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3" aria-label="Usage defaults">
        <Eyebrow>Usage</Eyebrow>
        <p className="text-sm text-ink-dim">
          Readings are what the book trusts. Between readings it estimates from your logged sessions, and this is what one session counts as unless you say
          otherwise on the day.
        </p>
        <Toggle label="Track hours" hint="Hour meter, or time on track" checked={tracksHours} onChange={setTracksHours} />
        <Toggle label="Track distance" hint="Odometer" checked={tracksDistance} onChange={setTracksDistance} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Minutes per session" type="number" inputMode="numeric" min={1} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          {tracksDistance ? (
            <>
              <Input label={`Distance per session (${unit})`} type="number" inputMode="decimal" step="any" min={0} value={distance} onChange={(e) => setDistance(e.target.value)} />
              <div className="space-y-2">
                <label htmlFor={unitId} className="block text-sm font-medium text-ink-dim">
                  Distance unit
                </label>
                <select
                  id={unitId}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as DistanceUnit)}
                  disabled={unitLocked}
                  aria-describedby={unitLocked ? `${unitId}-locked` : undefined}
                  className={cn(selectClass, 'disabled:cursor-not-allowed disabled:opacity-60')}
                >
                  <option value="mi">Miles</option>
                  <option value="km">Kilometres</option>
                </select>
                {unitLocked ? (
                  <p id={`${unitId}-locked`} className="text-xs text-ink-faint">
                    {distanceUnitLockedReason(book.distance_unit)}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
        {error ? (
          <p className="text-sm text-slower" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={isPending} success={saved}>
          Save usage settings
        </Button>
      </form>
    </Card>
  );
}

interface FieldRow {
  key: string;
  id: string | null;
  builtinKey: string | null;
  label: string;
  fieldType: ServiceBookFieldType | null;
  options: string;
  enabled: boolean;
  required: boolean;
}

const FIELD_TYPE_LABEL: Record<ServiceBookFieldType, string> = {
  text: 'Text',
  number: 'Number',
  money: 'Money',
  choice: 'Choice',
  date: 'Date',
};

function FieldLayout({ vehicleId, fields }: { vehicleId: string; fields: ServiceBookField[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<FieldRow[]>(() =>
    [...fields]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((field) => ({
        key: field.id,
        id: field.id,
        builtinKey: field.builtin_key,
        label: field.label,
        fieldType: field.field_type,
        options: fieldOptions(field).join(', '),
        enabled: field.enabled,
        required: field.required,
      })),
  );
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<ServiceBookFieldType>('text');
  const [newOptions, setNewOptions] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const newTypeId = useId();

  function update(key: string, change: Partial<FieldRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function move(key: string, direction: -1 | 1) {
    setRows((current) => {
      const index = current.findIndex((row) => row.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addField() {
    const label = newLabel.trim();
    if (label === '') return;
    setRows((current) => [
      ...current,
      { key: `new-${Date.now()}`, id: null, builtinKey: null, label, fieldType: newType, options: newOptions, enabled: true, required: false },
    ]);
    setNewLabel('');
    setNewOptions('');
    setNewType('text');
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaved(false);
    const input: ServiceBookFieldInput[] = rows.map((row, index) => ({
      id: row.id,
      label: row.label,
      field_type: row.fieldType,
      options: row.fieldType === 'choice' ? row.options.split(',').map((option) => option.trim()).filter(Boolean) : null,
      enabled: row.enabled,
      required: row.required,
      sort_order: (index + 1) * 10,
    }));
    startTransition(async () => {
      const result = await updateServiceBookFields(vehicleId, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} aria-label="Entry fields">
      <CardGroup eyebrow="Entry fields" title="What an entry asks for">
        <GroupRow>
          <p className="text-sm text-ink-dim">
            Switch off what you do not keep, mark what you always want, and add fields of your own. A field switched off keeps the values already logged in it.
          </p>
        </GroupRow>
        {rows.map((row, index) => (
          <GroupRow key={row.key} className={cn('space-y-2', !row.enabled && 'opacity-70')}>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input label={row.builtinKey ? `Label for ${row.builtinKey.replace('_', ' ')}` : `Label for your field`} type="text" value={row.label} onChange={(e) => update(row.key, { label: e.target.value })} className="bg-surface-3" />
              </div>
              <div className="flex flex-col gap-1 pt-7">
                <button type="button" aria-label={`Move ${row.label} up`} onClick={() => move(row.key, -1)} disabled={index === 0} className="flex h-11 w-11 items-center justify-center rounded-control bg-surface-3 text-ink-dim disabled:opacity-40">
                  ↑
                </button>
                <button type="button" aria-label={`Move ${row.label} down`} onClick={() => move(row.key, 1)} disabled={index === rows.length - 1} className="flex h-11 w-11 items-center justify-center rounded-control bg-surface-3 text-ink-dim disabled:opacity-40">
                  ↓
                </button>
              </div>
            </div>
            {row.builtinKey === null ? (
              <p className="text-xs text-ink-faint">
                Your field · {row.fieldType ? FIELD_TYPE_LABEL[row.fieldType] : ''}
              </p>
            ) : row.builtinKey === 'attachments' ? (
              <p className="text-xs text-ink-faint">Added from a saved entry&apos;s page.</p>
            ) : null}
            {row.fieldType === 'choice' ? (
              <Input label={`Choices for ${row.label}, separated by commas`} type="text" value={row.options} onChange={(e) => update(row.key, { options: e.target.value })} className="bg-surface-3" />
            ) : null}
            <div className="flex flex-wrap gap-4">
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink-dim">
                <input type="checkbox" className={checkboxClass} checked={row.enabled} onChange={(e) => update(row.key, { enabled: e.target.checked })} />
                Shown on entries
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink-dim">
                <input type="checkbox" className={checkboxClass} checked={row.required} onChange={(e) => update(row.key, { required: e.target.checked })} disabled={!row.enabled} />
                Required
              </label>
            </div>
          </GroupRow>
        ))}
        <GroupRow className="space-y-2">
          <p className="text-sm font-medium text-ink">Add a field</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input label="Field name" type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Tyre pressure after" className="bg-surface-3" />
            <div className="space-y-2">
              <label htmlFor={newTypeId} className="block text-sm font-medium text-ink-dim">
                It holds
              </label>
              <select id={newTypeId} value={newType} onChange={(e) => setNewType(e.target.value as ServiceBookFieldType)} className={cn(selectClass, 'bg-surface-3')}>
                {(Object.keys(FIELD_TYPE_LABEL) as ServiceBookFieldType[]).map((type) => (
                  <option key={type} value={type}>
                    {FIELD_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {newType === 'choice' ? (
            <Input label="Choices, separated by commas" type="text" value={newOptions} onChange={(e) => setNewOptions(e.target.value)} placeholder="e.g. Street, Track, Race" className="bg-surface-3" />
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={addField} disabled={newLabel.trim() === ''}>
            + Add field
          </Button>
        </GroupRow>
        {error ? (
          <p className="px-3 text-sm text-slower" role="alert">
            {error}
          </p>
        ) : null}
        <div className="p-1">
          <Button type="submit" loading={isPending} success={saved}>
            Save entry fields
          </Button>
        </div>
      </CardGroup>
    </form>
  );
}

function ScheduleItem({ vehicleId, item, unit }: { vehicleId: string; item: ServiceItemRow | null; unit: DistanceUnit }) {
  const router = useRouter();
  const [name, setName] = useState(item?.name ?? '');
  const [hours, setHours] = useState(numberText(item?.interval_hours));
  const [distance, setDistance] = useState(numberText(item?.interval_distance));
  const [days, setDays] = useState(numberText(item?.interval_days));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function save(archived: boolean) {
    setError('');
    setSaved(false);
    const parsed = [parseNumberText(hours), parseNumberText(distance), parseNumberText(days)];
    if (parsed.some((value) => !value.ok)) {
      setError('An interval has to be a number.');
      return;
    }
    const [intervalHours, intervalDistance, intervalDays] = parsed.map((value) => (value.ok ? value.value : null));
    startTransition(async () => {
      const result = await saveServiceItem(vehicleId, {
        id: item?.id ?? null,
        name,
        interval_hours: intervalHours,
        interval_distance: intervalDistance,
        interval_days: intervalDays,
        archived,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (item === null) {
        setName('');
        setHours('');
        setDistance('');
        setDays('');
      }
      setSaved(true);
      router.refresh();
    });
  }

  const archived = item?.archived_at !== null && item?.archived_at !== undefined;
  const label = item ? item.name : 'New item';

  return (
    <GroupRow className={cn('space-y-2', archived && 'opacity-70')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(archived);
        }}
        aria-label={label}
        className="space-y-2"
      >
        <Input label="Item" type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Engine oil and filter" className="bg-surface-3" />
        <div className="grid grid-cols-3 gap-2">
          <Input label="Every (h)" type="number" inputMode="decimal" step="any" min={0} value={hours} onChange={(e) => setHours(e.target.value)} className="bg-surface-3" />
          <Input label={`Every (${unit})`} type="number" inputMode="decimal" step="any" min={0} value={distance} onChange={(e) => setDistance(e.target.value)} className="bg-surface-3" />
          <Input label="Every (days)" type="number" inputMode="numeric" step={1} min={0} value={days} onChange={(e) => setDays(e.target.value)} className="bg-surface-3" />
        </div>
        {error ? (
          <p className="text-sm text-slower" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={isPending} success={saved}>
            {item ? 'Save item' : 'Add item'}
          </Button>
          {item ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => save(!archived)} disabled={isPending}>
              {archived ? 'Restore to schedule' : 'Archive'}
            </Button>
          ) : null}
        </div>
      </form>
    </GroupRow>
  );
}

function Schedule({ vehicleId, items, unit }: { vehicleId: string; items: ServiceItemRow[]; unit: DistanceUnit }) {
  const sorted = [...items].sort((a, b) => Number(a.archived_at !== null) - Number(b.archived_at !== null) || a.sort_order - b.sort_order);
  return (
    <CardGroup eyebrow="Schedule" title="Items and intervals">
      <GroupRow>
        <p className="text-sm text-ink-dim">
          An item with no interval is never due. Type the intervals from the manual, in hours, {unit === 'km' ? 'kilometres' : 'miles'} or days - any of them, or
          all three.
        </p>
      </GroupRow>
      {sorted.map((item) => (
        <ScheduleItem key={item.id} vehicleId={vehicleId} item={item} unit={unit} />
      ))}
      <ScheduleItem vehicleId={vehicleId} item={null} unit={unit} />
    </CardGroup>
  );
}
