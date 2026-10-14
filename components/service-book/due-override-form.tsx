'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChoiceRow } from '@/components/ui/choice-row';
import { Input } from '@/components/ui/input';
import { addServiceDueOverride, type ServiceDueOverrideInput } from '@/lib/actions/service-book';
import { todayLocalDate } from '@/lib/local-date';
import type { ItemDue } from '@/lib/service-book/due';
import { formatDistance, formatHours, parseNumberText } from '@/lib/service-book/format';
import type { BookUsage } from '@/lib/service-book/usage';
import type { DistanceUnit, ServiceDueOverrideKind } from '@/types/supabase';

interface DueOverrideFormProps {
  vehicleId: string;
  item: { id: string; name: string };
  book: { tracks_hours: boolean; tracks_distance: boolean; distance_unit: DistanceUnit };
  /** Usage now, for where a skipped cycle starts counting; `null` until the clock is read. */
  usage: BookUsage | null;
  due: ItemDue | null;
}

const KIND_OPTIONS: readonly { value: ServiceDueOverrideKind; label: string }[] = [
  { value: 'snooze', label: 'Snooze' },
  { value: 'skip_cycle', label: 'Skip a cycle' },
  { value: 'set_next_due', label: 'Set next due' },
];

/**
 * The rider's overrides of one item's reminder (owner, 2026-10-08: reminders
 * are suggestions; the rider decides). Opens with no kind pressed, because a
 * default is not an answer; each kind asks only for what `lib/service-book/due.ts`
 * reads. A skipped cycle starts the count from where the bike is now, which is
 * worked out here because usage is a device-side figure, and is never a
 * service. "Clear" is a snooze that ends today, which is how the rule reads
 * "the schedule's own answer again" without a delete the grants do not allow.
 */
export function DueOverrideForm({ vehicleId, item, book, usage, due }: DueOverrideFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ServiceDueOverrideKind | null>(null);
  const [untilDate, setUntilDate] = useState('');
  const [hours, setHours] = useState('');
  const [distance, setDistance] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const unit = book.distance_unit;
  const nowHours = book.tracks_hours ? (usage?.hours?.current ?? null) : null;
  const nowDistance = book.tracks_distance ? (usage?.distance?.current ?? null) : null;

  function reset() {
    setOpen(false);
    setKind(null);
    setUntilDate('');
    setHours('');
    setDistance('');
    setError('');
  }

  function write(input: ServiceDueOverrideInput) {
    setError('');
    startTransition(async () => {
      const result = await addServiceDueOverride(vehicleId, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (kind === null) {
      setError('Choose what to do: snooze, skip a cycle, or set the next due point.');
      return;
    }
    const parsedHours = parseNumberText(hours);
    const parsedDistance = parseNumberText(distance);
    if (!parsedHours.ok || !parsedDistance.ok) {
      setError('Hours and distance have to be numbers.');
      return;
    }
    const base = { item_id: item.id, kind, until_date: null, until_hours: null, until_distance: null, anchor_hours: null, anchor_distance: null, note: null };
    if (kind === 'skip_cycle') {
      write({ ...base, anchor_hours: nowHours, anchor_distance: nowDistance });
      return;
    }
    const date = untilDate.trim() === '' ? null : untilDate;
    if (kind === 'set_next_due' && date === null && parsedHours.value === null && parsedDistance.value === null) {
      setError('Say when it is next due: a date, hours, or distance.');
      return;
    }
    write({
      ...base,
      until_date: date,
      until_hours: book.tracks_hours ? parsedHours.value : null,
      until_distance: book.tracks_distance ? parsedDistance.value : null,
    });
  }

  function clear() {
    write({
      item_id: item.id,
      kind: 'snooze',
      until_date: todayLocalDate(),
      until_hours: null,
      until_distance: null,
      anchor_hours: null,
      anchor_distance: null,
      note: 'cleared',
    });
  }

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Adjust ${item.name}`}>
          Adjust
        </Button>
        {due?.override ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear} loading={isPending} aria-label={`Clear the override on ${item.name}`}>
            Clear
          </Button>
        ) : null}
        {error ? (
          <p className="basis-full text-sm text-slower" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const whereNow = [formatHours(nowHours), formatDistance(nowDistance, unit)].filter((text): text is string => text !== null);

  return (
    <form onSubmit={submit} aria-label={`Adjust ${item.name}`} className="mt-3 space-y-3">
      <ChoiceRow label="What to do" options={KIND_OPTIONS} value={kind} onChange={setKind} className="bg-surface-3" />
      {kind === 'snooze' ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-dim">Quiet until a date or a reading, whichever comes first. Leave all blank to quiet it until it is logged again.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input label="Until date" type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} className="bg-surface-3" />
            {book.tracks_hours ? (
              <Input label="Until hours" type="number" inputMode="decimal" step="any" min={0} value={hours} onChange={(e) => setHours(e.target.value)} className="bg-surface-3" />
            ) : null}
            {book.tracks_distance ? (
              <Input label={`Until ${unit}`} type="number" inputMode="decimal" step="any" min={0} value={distance} onChange={(e) => setDistance(e.target.value)} className="bg-surface-3" />
            ) : null}
          </div>
        </div>
      ) : null}
      {kind === 'skip_cycle' ? (
        <p className="text-xs text-ink-dim">
          Starts the count again from where the bike is now{whereNow.length > 0 ? ` (≈ ${whereNow.join(' · ')})` : ''}, one interval on. Not a service: nothing is logged.
        </p>
      ) : null}
      {kind === 'set_next_due' ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-dim">The points you type are the only due points until this item is logged again.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {book.tracks_hours ? (
              <Input label="Next due at (h)" type="number" inputMode="decimal" step="any" min={0} value={hours} onChange={(e) => setHours(e.target.value)} className="bg-surface-3" />
            ) : null}
            {book.tracks_distance ? (
              <Input label={`Next due at (${unit})`} type="number" inputMode="decimal" step="any" min={0} value={distance} onChange={(e) => setDistance(e.target.value)} className="bg-surface-3" />
            ) : null}
            <Input label="Next due by" type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} className="bg-surface-3" />
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-slower" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
