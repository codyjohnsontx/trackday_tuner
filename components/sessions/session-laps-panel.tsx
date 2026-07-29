'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { LapTimeEditor } from '@/components/sessions/lap-time-editor';
import { replaceSessionLaps } from '@/lib/actions/sessions';
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

export function SessionLapsPanel({ sessionId, vehicleId, initialLaps, demoMode }: { sessionId: string; vehicleId: string; initialLaps: SessionLap[]; demoMode: boolean }) {
  const [editing, setEditing] = useState(false);
  const [laps, setLaps] = useState<CreateSessionLapInput[]>(initialLaps.map((lap) => ({
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    included: lap.included,
  })));
  const [savedLaps, setSavedLaps] = useState(laps);
  // Severity travels with the text. Saving also collapses the editor, so the
  // confirmation has to survive into the collapsed view or it is never seen.
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing && savedLaps.length === 0) {
    return (
      <Button type="button" variant="secondary" fullWidth disabled={demoMode} onClick={() => setEditing(true)}>
        Add Lap Times
      </Button>
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
    startTransition(async () => {
      const result = await replaceSessionLaps(sessionId, laps);
      if (!result.ok) { setMessage({ text: result.error, ok: false }); return; }
      trackProductEvent('lap_data_saved', { session_id: sessionId, vehicle_id: vehicleId, properties: { lap_count: laps.length, source: 'session_edit' } });
      setSavedLaps(laps);
      setEditing(false);
      setMessage({ text: 'Lap data saved.', ok: true });
    });
  }

  return (
    <div className="space-y-3">
      <LapTimeEditor value={laps} onChange={setLaps} />
      {message ? <Message message={message} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={() => { setLaps(savedLaps); setEditing(false); }}>Cancel</Button>
        <Button type="button" loading={pending} onClick={save}>Save laps</Button>
      </div>
    </div>
  );
}
