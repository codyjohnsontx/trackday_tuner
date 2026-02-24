'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { TrackDeleteForm } from '@/components/tracks/track-delete-form';
import type { Track } from '@/types';

interface TrackListClientProps {
  tracks: Track[];
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function TrackListClient({ tracks }: TrackListClientProps) {
  const [query, setQuery] = useState('');

  const filteredTracks = useMemo(() => {
    const q = normalize(query);
    if (!q) return tracks;

    return tracks.filter((track) => {
      const name = normalize(track.name);
      const location = normalize(track.location ?? '');
      return name.includes(q) || location.includes(q);
    });
  }, [query, tracks]);

  const customTracks = filteredTracks.filter((track) => !track.is_seeded);
  const seededTracks = filteredTracks.filter((track) => track.is_seeded);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <Input
          label="Search tracks"
          type="search"
          placeholder="Search by name or location"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Your Custom Tracks</h2>
          <span className="text-xs text-zinc-500">{customTracks.length}</span>
        </div>

        {customTracks.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            {query ? 'No custom tracks match your search.' : 'No custom tracks yet.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {customTracks.map((track) => (
              <li key={track.id} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{track.name}</p>
                    {track.location ? <p className="text-xs text-zinc-400">{track.location}</p> : null}
                  </div>
                  <span className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
                    Custom
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href={`/tracks/${track.id}`}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center text-sm font-medium text-zinc-100 hover:bg-zinc-800"
                  >
                    View
                  </Link>
                  <Link
                    href={`/tracks/${track.id}`}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center text-sm font-medium text-zinc-100 hover:bg-zinc-800"
                  >
                    Edit
                  </Link>
                </div>
                <TrackDeleteForm trackId={track.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Seeded Tracks</h2>
          <span className="text-xs text-zinc-500">{seededTracks.length}</span>
        </div>

        {seededTracks.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No seeded tracks match your search.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {seededTracks.map((track) => (
              <li key={track.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{track.name}</p>
                    {track.location ? <p className="text-xs text-zinc-400">{track.location}</p> : null}
                  </div>
                  <span className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
                    Read-only
                  </span>
                </div>
                <div className="mt-3">
                  <Link
                    href={`/tracks/${track.id}`}
                    className="block rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center text-sm font-medium text-zinc-100 hover:bg-zinc-800"
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
