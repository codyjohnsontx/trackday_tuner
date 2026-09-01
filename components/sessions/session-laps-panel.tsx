'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { LapTimeEditor } from '@/components/sessions/lap-time-editor';
import { replaceSessionLaps } from '@/lib/actions/sessions';
import { commitLapEditorValue, lapEditorValueFrom, type LapEditorValue } from '@/lib/lap-times';
import { trackProductEvent } from '@/lib/product-events.client';
import { cn } from '@/lib/utils';
import type { CreateSessionLapInput, SessionLap } from '@/types';

function Message({ message }: { message: { text: string; ok: boolean } }) {
  return (
    <p className={cn('text-sm', message.ok ? 'text-faster' : 'text-slower')} role="status">
      {message.text}
    </p>
  );
}

/**
 * What the panel shows when the laps could not be read.
 *
 * It offers nothing that saves, and that is the point rather than a courtesy.
 * `replace_session_laps` deletes every lap on the session before inserting, so a
 * rider shown "Add Lap Times" on a session that actually holds laps destroys the
 * rest by retyping what they remember - their own recovery is what loses the
 * data. A failed read and a session with no laps therefore cannot look the same
 * here: this says which one happened and leaves the stored rows alone until the
 * read succeeds.
 */
function LapsUnavailable() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  return (
    <section className="rounded-card bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Lap Data</h2>
      <p className="mt-2 text-sm text-slower">Lap times could not be loaded for this session.</p>
      <p className="mt-1 text-sm text-ink-dim">
        Editing stays off until they load, so nothing already saved gets overwritten.
      </p>
      <Button
        type="button"
        variant="secondary"
        fullWidth
        className="mt-3"
        loading={refreshing}
        onClick={() => startRefresh(() => router.refresh())}
      >
        Try again
      </Button>
    </section>
  );
}

function LapsEditor({ sessionId, vehicleId, initialLaps, demoMode }: { sessionId: string; vehicleId: string; initialLaps: SessionLap[]; demoMode: boolean }) {
  const [editing, setEditing] = useState(false);
  const [editorValue, setEditorValue] = useState<LapEditorValue>(() => lapEditorValueFrom(initialLaps.map((lap) => ({
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    included: lap.included,
  }))));
  const [savedLaps, setSavedLaps] = useState<CreateSessionLapInput[]>(editorValue.laps);
  // Severity travels with the text. Saving also collapses the editor, so the
  // confirmation has to survive into the collapsed view or it is never seen.
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing && savedLaps.length === 0) {
    // The message rides along here for the same reason it does in the collapsed
    // view below: a save collapses the editor, and this is the view a rider
    // lands in after clearing every lap. Without it that save reported nothing
    // at all - the panel just became "Add Lap Times" again, which is what an
    // untouched session looks like.
    return (
      <div className="space-y-2">
        <Button type="button" variant="secondary" fullWidth disabled={demoMode} onClick={() => setEditing(true)}>
          Add Lap Times
        </Button>
        {message ? <Message message={message} /> : null}
      </div>
    );
  }

  if (!editing) {
    return (
      <section className="rounded-card bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Lap Data</h2><p className="mt-1 text-sm text-ink-dim">{savedLaps.filter((lap) => lap.included).length} included laps</p></div>
          <Button type="button" variant="secondary" disabled={demoMode} onClick={() => setEditing(true)}>Edit</Button>
        </div>
        {message ? <div className="mt-3"><Message message={message} /></div> : null}
      </section>
    );
  }

  function save() {
    setMessage(null);
    // Text still sitting in the lap editor's entry boxes is part of what the
    // rider is saving, so it is folded in here rather than dropped.
    const committed = commitLapEditorValue(editorValue);
    if (!committed.ok) { setMessage({ text: committed.error, ok: false }); return; }
    const laps = committed.laps;

    // Saving nothing is a delete of everything, because the RPC replaces the
    // whole set rather than merging into it. Same shape as replacing a vehicle
    // baseline in set-vehicle-baseline-button.tsx - an ordinary save that in one
    // case destroys stored data - so it is confirmed rather than silent.
    if (laps.length === 0 && savedLaps.length > 0) {
      const plural = savedLaps.length === 1 ? 'lap' : 'laps';
      if (!window.confirm(`Delete all ${savedLaps.length} saved ${plural} on this session?`)) return;
    }

    startTransition(async () => {
      // The count is what this panel read, so the database can refuse a save
      // built on laps it never managed to hand over. See replaceSessionLaps.
      const result = await replaceSessionLaps(sessionId, laps, savedLaps.length);
      if (!result.ok) { setMessage({ text: result.error, ok: false }); return; }
      trackProductEvent('lap_data_saved', { session_id: sessionId, vehicle_id: vehicleId, properties: { lap_count: laps.length, source: 'session_edit' } });
      setEditorValue(lapEditorValueFrom(laps));
      setSavedLaps(laps);
      setEditing(false);
      setMessage({ text: 'Lap data saved.', ok: true });
    });
  }

  return (
    <div className="space-y-3">
      <LapTimeEditor value={editorValue} onChange={setEditorValue} />
      {message ? <Message message={message} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={() => { setEditorValue(lapEditorValueFrom(savedLaps)); setEditing(false); }}>Cancel</Button>
        <Button type="button" loading={pending} onClick={save}>Save laps</Button>
      </div>
    </div>
  );
}

/**
 * `initialLaps` is `null` when the read failed, and an array - empty or not -
 * when it succeeded. The editor lives in its own component so the two answers
 * are separate mounts: a "Try again" that succeeds swaps `LapsUnavailable` for a
 * fresh `LapsEditor` whose state is built from the laps that finally arrived,
 * rather than an editor still holding the empty list it was seeded with.
 */
export function SessionLapsPanel({ sessionId, vehicleId, initialLaps, demoMode }: { sessionId: string; vehicleId: string; initialLaps: SessionLap[] | null; demoMode: boolean }) {
  if (initialLaps === null) return <LapsUnavailable />;

  return <LapsEditor sessionId={sessionId} vehicleId={vehicleId} initialLaps={initialLaps} demoMode={demoMode} />;
}
