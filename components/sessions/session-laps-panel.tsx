'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { LapTimeEditor } from '@/components/sessions/lap-time-editor';
import { replaceSessionLaps } from '@/lib/actions/sessions';
import { trackProductEvent } from '@/lib/product-events.client';
import type { CreateSessionLapInput, SessionLap } from '@/types';

export function SessionLapsPanel({ sessionId, vehicleId, initialLaps, demoMode }: { sessionId: string; vehicleId: string; initialLaps: SessionLap[]; demoMode: boolean }) {
  const [editing, setEditing] = useState(false);
  const [laps, setLaps] = useState<CreateSessionLapInput[]>(initialLaps.map((lap) => ({
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    included: lap.included,
  })));
  const [savedLaps, setSavedLaps] = useState(laps);
  const [message, setMessage] = useState('');
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
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Lap Data</h2><p className="mt-1 text-sm text-zinc-300">{savedLaps.filter((lap) => lap.included).length} included laps</p></div>
          <Button type="button" variant="secondary" disabled={demoMode} onClick={() => setEditing(true)}>Edit</Button>
        </div>
      </section>
    );
  }

  function save() {
    setMessage('');
    startTransition(async () => {
      const result = await replaceSessionLaps(sessionId, laps);
      if (!result.ok) { setMessage(result.error); return; }
      trackProductEvent('lap_data_saved', { session_id: sessionId, vehicle_id: vehicleId, properties: { lap_count: laps.length, source: 'session_edit' } });
      setSavedLaps(laps);
      setEditing(false);
      setMessage('Lap data saved.');
    });
  }

  return (
    <div className="space-y-3">
      <LapTimeEditor value={laps} onChange={setLaps} />
      {message ? <p className="text-sm text-rose-300">{message}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={() => { setLaps(savedLaps); setEditing(false); }}>Cancel</Button>
        <Button type="button" loading={pending} onClick={save}>Save laps</Button>
      </div>
    </div>
  );
}
