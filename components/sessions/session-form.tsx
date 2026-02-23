'use client';

import { useTransition, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { createSession } from '@/lib/actions/sessions';
import type {
  Vehicle,
  Track,
  SessionCondition,
  TireCondition,
  SuspensionDirection,
  Tires,
  Suspension,
  Alignment,
} from '@/types';

interface SessionFormProps {
  vehicles: Vehicle[];
  tracks: Track[];
}

const today = new Date().toISOString().split('T')[0];

const emptyTireEnd = { brand: '', compound: '', pressure: '' };
const emptySuspEnd = { preload: '', compression: '', rebound: '', direction: 'out' as SuspensionDirection };

export function SessionForm({ vehicles, tracks }: SessionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [vehicleId, setVehicleId] = useState(
    vehicles.length === 1 ? vehicles[0].id : '',
  );
  const [trackQuery, setTrackQuery] = useState('');
  const [trackId, setTrackId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [date, setDate] = useState(today);
  const [conditions, setConditions] = useState<SessionCondition>('sunny');
  const [tireCondition, setTireCondition] = useState<TireCondition>('scrubbed');
  const [frontTire, setFrontTire] = useState(emptyTireEnd);
  const [rearTire, setRearTire] = useState(emptyTireEnd);
  const [frontSusp, setFrontSusp] = useState(emptySuspEnd);
  const [rearSusp, setRearSusp] = useState(emptySuspEnd);
  const [alignment, setAlignment] = useState<Alignment>({
    front_camber: '', rear_camber: '', front_toe: '', rear_toe: '', caster: '',
  });
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === vehicleId) ?? null,
    [vehicles, vehicleId],
  );
  const showAlignment = selectedVehicle?.type === 'car';

  const filteredTracks = useMemo(() => {
    const q = trackQuery.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => t.name.toLowerCase().includes(q));
  }, [tracks, trackQuery]);

  function handleTrackSelect(track: Track) {
    setTrackQuery(track.name);
    setTrackId(track.id);
    setShowDropdown(false);
  }

  function handleTrackInputChange(value: string) {
    setTrackQuery(value);
    setTrackId(null);
    setShowDropdown(true);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');

    if (!vehicleId) {
      setErrorMessage('Please select a vehicle.');
      return;
    }
    if (!date) {
      setErrorMessage('Please enter a date.');
      return;
    }

    const tires: Tires = {
      front: frontTire,
      rear: rearTire,
      condition: tireCondition,
    };
    const suspension: Suspension = { front: frontSusp, rear: rearSusp };
    const alignmentData: Alignment | null = showAlignment ? alignment : null;

    startTransition(async () => {
      const result = await createSession({
        vehicle_id: vehicleId,
        track_id: trackId,
        track_name: trackQuery.trim() || null,
        date,
        conditions,
        tires,
        suspension,
        alignment: alignmentData,
        notes: notes.trim() || null,
      });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      router.push('/sessions');
      router.refresh();
    });
  }

  const conditionOptions: { value: SessionCondition; label: string }[] = [
    { value: 'sunny', label: 'Sunny' },
    { value: 'overcast', label: 'Overcast' },
    { value: 'rainy', label: 'Rainy' },
    { value: 'mixed', label: 'Mixed' },
  ];

  const tireConditionOptions: { value: TireCondition; label: string }[] = [
    { value: 'new', label: 'New' },
    { value: 'scrubbed', label: 'Scrubbed' },
    { value: 'used', label: 'Used' },
    { value: 'worn', label: 'Worn' },
  ];

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {/* Vehicle & Date */}
      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Session Info
        </span>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-zinc-300">Vehicle</label>
          <select
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            required
          >
            <option value="" disabled>Select a vehicle</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.nickname}</option>
            ))}
          </select>
        </div>

        {/* Track combobox */}
        <div className="relative space-y-1">
          <label className="block text-sm font-medium text-zinc-300">Track</label>
          <input
            type="text"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400 focus:outline-none"
            placeholder="Search or type a track name"
            value={trackQuery}
            autoComplete="off"
            onChange={(e) => handleTrackInputChange(e.target.value)}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          />
          {showDropdown && filteredTracks.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg">
              {filteredTracks.map((track) => (
                <li key={track.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                    onMouseDown={() => handleTrackSelect(track)}
                  >
                    <span className="font-medium">{track.name}</span>
                    {track.location ? (
                      <span className="ml-1 text-zinc-500">{track.location}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      {/* Conditions */}
      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Conditions
        </span>
        <div className="grid grid-cols-4 gap-2 rounded-xl bg-zinc-950 p-1">
          {conditionOptions.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant={conditions === opt.value ? 'primary' : 'secondary'}
              className="min-h-10 px-1 text-xs"
              onClick={() => setConditions(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Tires */}
      <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Tires
        </span>

        <div className="space-y-2">
          <span className="text-xs font-medium text-zinc-400">Condition</span>
          <div className="grid grid-cols-4 gap-2 rounded-xl bg-zinc-950 p-1">
            {tireConditionOptions.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={tireCondition === opt.value ? 'primary' : 'secondary'}
                className="min-h-10 px-1 text-xs"
                onClick={() => setTireCondition(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <span className="text-xs font-medium text-zinc-400">Front</span>
          <Input
            label="Brand"
            type="text"
            placeholder="e.g. Pirelli"
            value={frontTire.brand}
            onChange={(e) => setFrontTire({ ...frontTire, brand: e.target.value })}
            autoComplete="off"
          />
          <Input
            label="Compound"
            type="text"
            placeholder="e.g. SC2"
            value={frontTire.compound}
            onChange={(e) => setFrontTire({ ...frontTire, compound: e.target.value })}
            autoComplete="off"
          />
          <Input
            label="Pressure"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 32.5"
            value={frontTire.pressure}
            onChange={(e) => setFrontTire({ ...frontTire, pressure: e.target.value })}
          />
        </div>

        <div className="space-y-3">
          <span className="text-xs font-medium text-zinc-400">Rear</span>
          <Input
            label="Brand"
            type="text"
            placeholder="e.g. Pirelli"
            value={rearTire.brand}
            onChange={(e) => setRearTire({ ...rearTire, brand: e.target.value })}
            autoComplete="off"
          />
          <Input
            label="Compound"
            type="text"
            placeholder="e.g. SC1"
            value={rearTire.compound}
            onChange={(e) => setRearTire({ ...rearTire, compound: e.target.value })}
            autoComplete="off"
          />
          <Input
            label="Pressure"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 28.5"
            value={rearTire.pressure}
            onChange={(e) => setRearTire({ ...rearTire, pressure: e.target.value })}
          />
        </div>
      </div>

      {/* Suspension */}
      <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Suspension
        </span>

        {/* Front */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">Front</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Clicks counted</span>
              <InfoTooltip text="Out — rotate the adjuster fully clockwise (full hard) until it stops, then count each click as you back it out. Most common standard. In — count from fully open (full soft). Some manufacturers use this. Check your manual if unsure." />
              <div className="flex overflow-hidden rounded-lg border border-zinc-700">
                <button
                  type="button"
                  onClick={() => setFrontSusp({ ...frontSusp, direction: 'out' })}
                  className={`px-3 py-1 text-xs font-medium transition ${frontSusp.direction === 'out' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
                >
                  Out
                </button>
                <button
                  type="button"
                  onClick={() => setFrontSusp({ ...frontSusp, direction: 'in' })}
                  className={`px-3 py-1 text-xs font-medium transition ${frontSusp.direction === 'in' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
                >
                  In
                </button>
              </div>
            </div>
          </div>
          <Input
            label="Preload"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 5"
            value={frontSusp.preload}
            onChange={(e) => setFrontSusp({ ...frontSusp, preload: e.target.value })}
          />
          <Input
            label="Compression"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 12"
            value={frontSusp.compression}
            onChange={(e) => setFrontSusp({ ...frontSusp, compression: e.target.value })}
          />
          <Input
            label="Rebound"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 14"
            value={frontSusp.rebound}
            onChange={(e) => setFrontSusp({ ...frontSusp, rebound: e.target.value })}
          />
        </div>

        {/* Rear */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">Rear</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Clicks counted</span>
              <InfoTooltip text="Out — rotate the adjuster fully clockwise (full hard) until it stops, then count each click as you back it out. Most common standard. In — count from fully open (full soft). Some manufacturers use this. Check your manual if unsure." />
              <div className="flex overflow-hidden rounded-lg border border-zinc-700">
                <button
                  type="button"
                  onClick={() => setRearSusp({ ...rearSusp, direction: 'out' })}
                  className={`px-3 py-1 text-xs font-medium transition ${rearSusp.direction === 'out' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
                >
                  Out
                </button>
                <button
                  type="button"
                  onClick={() => setRearSusp({ ...rearSusp, direction: 'in' })}
                  className={`px-3 py-1 text-xs font-medium transition ${rearSusp.direction === 'in' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
                >
                  In
                </button>
              </div>
            </div>
          </div>
          <Input
            label="Preload"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 8"
            value={rearSusp.preload}
            onChange={(e) => setRearSusp({ ...rearSusp, preload: e.target.value })}
          />
          <Input
            label="Compression"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 10"
            value={rearSusp.compression}
            onChange={(e) => setRearSusp({ ...rearSusp, compression: e.target.value })}
          />
          <Input
            label="Rebound"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 16"
            value={rearSusp.rebound}
            onChange={(e) => setRearSusp({ ...rearSusp, rebound: e.target.value })}
          />
        </div>
      </div>

      {/* Alignment (cars only) */}
      {showAlignment ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Alignment
          </span>
          <Input
            label="Front Camber"
            type="text"
            inputMode="numeric"
            placeholder="e.g. -2.5"
            value={alignment.front_camber}
            onChange={(e) => setAlignment({ ...alignment, front_camber: e.target.value })}
          />
          <Input
            label="Rear Camber"
            type="text"
            inputMode="numeric"
            placeholder="e.g. -1.8"
            value={alignment.rear_camber}
            onChange={(e) => setAlignment({ ...alignment, rear_camber: e.target.value })}
          />
          <Input
            label="Front Toe"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 0.1"
            value={alignment.front_toe}
            onChange={(e) => setAlignment({ ...alignment, front_toe: e.target.value })}
          />
          <Input
            label="Rear Toe"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 0.2"
            value={alignment.rear_toe}
            onChange={(e) => setAlignment({ ...alignment, rear_toe: e.target.value })}
          />
          <Input
            label="Caster"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 6.5"
            value={alignment.caster}
            onChange={(e) => setAlignment({ ...alignment, caster: e.target.value })}
          />
        </div>
      ) : null}

      {/* Notes */}
      <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Notes
        </label>
        <textarea
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400 focus:outline-none"
          rows={4}
          placeholder="Observations, lap times, what to try next..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {errorMessage ? (
        <p className="text-sm text-rose-300">{errorMessage}</p>
      ) : null}

      <Button type="submit" fullWidth disabled={isPending}>
        {isPending ? 'Saving...' : 'Save Session'}
      </Button>
    </form>
  );
}
