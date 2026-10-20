'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardGroup, Eyebrow, GroupRow } from '@/components/ui/surface';
import { formatInstant, useRiderClock } from '@/components/service-book/rider-clock';
import { removeServiceEntry } from '@/lib/actions/service-book';
import { ownerLabelTimeZone, type ServiceEntryRecord, type ServiceEntryRevisionRecord } from '@/lib/service-book/book-data';
import { describeEntryProvenance } from '@/lib/service-book/provenance';
import { formatReading, formatServiceDate } from '@/lib/service-book/format';
import type { DistanceUnit, ServiceEntryRevisionKind } from '@/types/supabase';

interface ServiceEntryHistoryProps {
  vehicleId: string;
  entry: ServiceEntryRecord;
  revisions: ServiceEntryRevisionRecord[];
  distanceUnit: DistanceUnit;
  /** The book's pinned `owner_time_zone`, null until one is recorded. */
  ownerTimeZone: string | null;
  /** The book's `transferred_at`: when the bike was handed to this owner, or null. */
  transferredAt: string | null;
  demoMode: boolean;
}

const KIND_LABEL: Record<ServiceEntryRevisionKind, string> = {
  created: 'Logged',
  edited: 'Edited',
  deleted: 'Removed',
  restored: 'Restored',
  transferred: 'Copied in a transfer',
};

/** What a snapshot says, in the words the list uses: date, items, reading, notes. */
function describeSnapshot(snapshot: unknown, unit: DistanceUnit): string[] {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const row = snapshot as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof row.service_date === 'string') lines.push(`Service date ${formatServiceDate(row.service_date)}`);
  const items = Array.isArray(row.items) ? row.items : [];
  const labels = items
    .map((item) => (item !== null && typeof item === 'object' ? (item as Record<string, unknown>).label : null))
    .filter((label): label is string => typeof label === 'string');
  if (labels.length > 0) lines.push(labels.join(', '));
  const reading = formatReading({ hours: row.reading_hours, distance: row.reading_distance }, unit);
  if (reading) lines.push(`Reading ${reading}`);
  if (typeof row.notes === 'string' && row.notes.trim() !== '') lines.push(row.notes);
  return lines;
}

/**
 * The honest-history labels on one entry and the list of its revisions - what
 * the owner reads above the edit form, and what a buyer will read in the
 * shared view. The labels come from `describeEntryProvenance` in the book's
 * pinned zone, the one the shared view uses (`ownerLabelTimeZone`).
 */
export function ServiceEntryHistory({ vehicleId, entry, revisions, distanceUnit, ownerTimeZone, transferredAt, demoMode }: ServiceEntryHistoryProps) {
  const clock = useRiderClock();
  const router = useRouter();
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const provenance = useMemo(
    () =>
      clock
        ? describeEntryProvenance({
            entry,
            revisions: entry.revisions,
            attachments: entry.attachments,
            transferredAt,
            timeZone: ownerLabelTimeZone(ownerTimeZone, clock.timeZone),
          })
        : null,
    [entry, clock, ownerTimeZone, transferredAt],
  );
  const copied = entry.copied_from_entry_id !== null;

  function remove() {
    setError('');
    startTransition(async () => {
      const result = await removeServiceEntry(vehicleId, entry.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/garage/${vehicleId}/book`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <Eyebrow>History</Eyebrow>
        <p className="mt-2 text-sm text-ink-dim">
          Work dated {formatServiceDate(entry.service_date)}, logged {formatInstant(entry.logged_at)}.
        </p>
        {provenance ? (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="History labels">
            {provenance.labels.map((label) => (
              <li key={label.kind} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink">
                {label.text}
              </li>
            ))}
          </ul>
        ) : null}
        {entry.deleted_at ? (
          <p className="mt-3 text-sm text-ink-faint">Removed from the book {formatInstant(entry.deleted_at)}. The entry stays in its history.</p>
        ) : null}
      </Card>

      <CardGroup eyebrow="Revisions" title={`${revisions.length} ${revisions.length === 1 ? 'revision' : 'revisions'}`}>
        {revisions.length === 0 ? (
          <GroupRow>
            <p className="text-sm text-ink-dim">The history could not be read.</p>
          </GroupRow>
        ) : (
          [...revisions]
            .sort((a, b) => b.revision - a.revision)
            .map((revision) => (
              <GroupRow key={revision.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-ink" data-testid="entry-revision">
                    {KIND_LABEL[revision.kind]}
                    <span className="text-ink-faint"> · revision {revision.revision}</span>
                  </p>
                  <p className="text-xs text-ink-faint">{formatInstant(revision.changed_at)}</p>
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {describeSnapshot(revision.snapshot, distanceUnit).map((line, index) => (
                    <li key={index} className="text-xs text-ink-dim">
                      {line}
                    </li>
                  ))}
                </ul>
              </GroupRow>
            ))
        )}
      </CardGroup>

      {demoMode || entry.deleted_at ? null : (
        <section className="rounded-card bg-surface p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Remove entry</h2>
          <p className="mt-2 text-sm text-ink-dim">
            {copied
              ? 'This entry came with the bike, so it can be removed but not edited. Removing takes it out of your book and stops its reading counting; the entry and its history are kept, the previous owner keeps their own copy, and a buyer’s view will say an entry was removed.'
              : 'Removing takes this entry out of your book and stops its reading counting. The entry and its history are kept, and a buyer’s view will say an entry was removed.'}
          </p>
          {error ? (
            <p className="mt-2 text-sm text-slower" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-3">
            <Button type="button" variant="destructive" holdToConfirm onConfirm={remove} holdingLabel="Keep holding…" loading={isPending}>
              Hold to remove
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
