'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { TrackDeleteForm } from '@/components/tracks/track-delete-form';
import { trackNameKey } from '@/lib/session-track';
import type { TrackAliasIndex, TrackLayoutIndex } from '@/lib/track-directory';
import { cn } from '@/lib/utils';
import type { Track } from '@/types';

interface TrackListClientProps {
  tracks: Track[];
  aliases?: TrackAliasIndex;
  layouts?: TrackLayoutIndex;
  demoMode?: boolean;
}

const noAliases: TrackAliasIndex = {};
const noLayouts: TrackLayoutIndex = {};

export function TrackListClient({
  tracks,
  aliases = noAliases,
  layouts = noLayouts,
  demoMode = false,
}: TrackListClientProps) {
  const [query, setQuery] = useState('');

  // Search finds a circuit by any name it is known by, the same way the New
  // Session field does - a rider looking for "Mosport" is looking for Canadian
  // Tire Motorsport Park. See lib/track-directory.ts.
  const aliasKeysByTrack = useMemo(() => {
    const byTrack = new Map<string, string[]>();
    for (const [key, id] of Object.entries(aliases)) {
      byTrack.set(id, [...(byTrack.get(id) ?? []), key]);
    }
    return byTrack;
  }, [aliases]);

  const filteredTracks = useMemo(() => {
    const q = trackNameKey(query);
    if (!q) return tracks;

    return tracks.filter((track) => {
      const name = trackNameKey(track.name);
      const location = trackNameKey(track.location);
      const known = aliasKeysByTrack.get(track.id) ?? [];
      return name.includes(q) || location.includes(q) || known.some((alias) => alias.includes(q));
    });
  }, [query, tracks, aliasKeysByTrack]);

  const customTracks = filteredTracks.filter((track) => !track.is_seeded);
  const seededTracks = filteredTracks.filter((track) => track.is_seeded);

  return (
    <div className="space-y-4">
      <section className="rounded-card bg-surface p-4">
        <Input
          label="Search tracks"
          type="search"
          placeholder="Search by name or location"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </section>

      <section className="rounded-card bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">Your Custom Tracks</h2>
          <span className="text-xs text-ink-faint">{customTracks.length}</span>
        </div>

        {customTracks.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">
            {query ? 'No custom tracks match your search.' : 'No custom tracks yet.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {customTracks.map((track) => (
              <li key={track.id} className="space-y-3 rounded-row bg-surface-3 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{track.name}</p>
                    {track.location ? <p className="text-xs text-ink-dim">{track.location}</p> : null}
                  </div>
                  <span className="rounded-plate bg-surface-2 px-2 py-1 text-xs text-ink-dim">
                    Custom
                  </span>
                </div>
                <div className={cn('grid gap-2', !demoMode && 'grid-cols-2')}>
                  <Link
                    href={`/tracks/${track.id}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-control bg-surface-2 px-3 text-sm font-medium text-ink transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
                  >
                    View
                  </Link>
                  {!demoMode ? (
                    <Link
                      href={`/tracks/${track.id}`}
                      className="inline-flex min-h-11 items-center justify-center rounded-control bg-surface-2 px-3 text-sm font-medium text-ink transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
                    >
                      Edit
                    </Link>
                  ) : null}
                </div>
                {!demoMode ? <TrackDeleteForm trackId={track.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">Seeded Tracks</h2>
          <span className="text-xs text-ink-faint">{seededTracks.length}</span>
        </div>

        {seededTracks.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">
            {query ? 'No seeded tracks match your search.' : 'No seeded tracks yet.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {seededTracks.map((track) => (
              <li key={track.id} className="rounded-row bg-surface-3 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{track.name}</p>
                    {track.location ? <p className="text-xs text-ink-dim">{track.location}</p> : null}
                    {layouts[track.id]?.length ? (
                      <p className="mt-1 text-xs text-ink-faint">
                        {layouts[track.id].map((layout) => layout.name).join(' · ')}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-plate bg-surface-2 px-2 py-1 text-xs text-ink-dim">
                    Read-only
                  </span>
                </div>
                <div className="mt-3">
                  <Link
                    href={`/tracks/${track.id}`}
                    className="block inline-flex min-h-11 items-center justify-center rounded-control bg-surface-2 px-3 text-sm font-medium text-ink transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
                  >
                    View
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
