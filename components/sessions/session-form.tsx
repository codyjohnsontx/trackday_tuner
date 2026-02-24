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
  ExtraModules,
} from '@/types';

interface SessionFormProps {
  vehicles: Vehicle[];
  tracks: Track[];
}

type ExtraModuleKey = 'geometry' | 'drivetrain' | 'aero';

const today = new Date().toISOString().split('T')[0];

const emptyTireEnd = { brand: '', compound: '', pressure: '' };
const emptySuspEnd = { preload: '', compression: '', rebound: '' };

export function SessionForm({ vehicles, tracks }: SessionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [vehicleId, setVehicleId] = useState(vehicles.length === 1 ? vehicles[0].id : '');
  const [trackQuery, setTrackQuery] = useState('');
  const [trackId, setTrackId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState('');
  const [conditions, setConditions] = useState<SessionCondition>('sunny');
  const [tireCondition, setTireCondition] = useState<TireCondition>('scrubbed');
  const [frontTire, setFrontTire] = useState(emptyTireEnd);
  const [rearTire, setRearTire] = useState(emptyTireEnd);
  const [suspensionDirection, setSuspensionDirection] = useState<SuspensionDirection>('out');
  const [frontSusp, setFrontSusp] = useState(emptySuspEnd);
  const [rearSusp, setRearSusp] = useState(emptySuspEnd);
  const [alignment, setAlignment] = useState<Alignment>({
    front_camber: '',
    rear_camber: '',
    front_toe: '',
    rear_toe: '',
    caster: '',
  });

  const [enabledModules, setEnabledModules] = useState<Record<ExtraModuleKey, boolean>>({
    geometry: false,
    drivetrain: false,
    aero: false,
  });
  const [showAdvancedModules, setShowAdvancedModules] = useState<Record<ExtraModuleKey, boolean>>({
    geometry: false,
    drivetrain: false,
    aero: false,
  });

  const [geometry, setGeometry] = useState({
    sag_front: '',
    sag_rear: '',
    fork_height: '',
    rear_ride_height: '',
    notes: '',
  });
  const [drivetrain, setDrivetrain] = useState({
    front_sprocket: '',
    rear_sprocket: '',
    chain_length: '',
    notes: '',
  });
  const [aero, setAero] = useState({
    wing_angle: '',
    splitter_setting: '',
    rake: '',
    notes: '',
  });

  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === vehicleId) ?? null,
    [vehicles, vehicleId]
  );

  const showAlignment = selectedVehicle?.type === 'car';
  const showGeometry = selectedVehicle?.type === 'motorcycle';
  const showDrivetrain = selectedVehicle?.type === 'motorcycle';
  const showAero = selectedVehicle?.type === 'car';

  const filteredTracks = useMemo(() => {
    const q = trackQuery.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => t.name.toLowerCase().includes(q));
  }, [tracks, trackQuery]);

  function toggleModule(module: ExtraModuleKey) {
    setEnabledModules((prev) => ({ ...prev, [module]: !prev[module] }));
  }

  function toggleAdvanced(module: ExtraModuleKey) {
    setShowAdvancedModules((prev) => ({ ...prev, [module]: !prev[module] }));
  }

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

  function buildExtraModules(): ExtraModules | null {
    const result: ExtraModules = {};

    if (showGeometry && enabledModules.geometry) {
      result.geometry = {
        sag_front: geometry.sag_front,
        sag_rear: geometry.sag_rear,
        fork_height: geometry.fork_height,
        rear_ride_height: geometry.rear_ride_height,
        notes: geometry.notes,
      };
    }

    if (showDrivetrain && enabledModules.drivetrain) {
      result.drivetrain = {
        front_sprocket: drivetrain.front_sprocket,
        rear_sprocket: drivetrain.rear_sprocket,
        chain_length: drivetrain.chain_length,
        notes: drivetrain.notes,
      };
    }

    if (showAero && enabledModules.aero) {
      result.aero = {
        wing_angle: aero.wing_angle,
        splitter_setting: aero.splitter_setting,
        rake: aero.rake,
        notes: aero.notes,
      };
    }

    return Object.keys(result).length > 0 ? result : null;
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

    const suspension: Suspension = {
      front: { ...frontSusp, direction: suspensionDirection },
      rear: { ...rearSusp, direction: suspensionDirection },
    };

    const alignmentData: Alignment | null = showAlignment ? alignment : null;
    const extraModules = buildExtraModules();

    startTransition(async () => {
      const result = await createSession({
        vehicle_id: vehicleId,
        track_id: trackId,
        track_name: trackQuery.trim() || null,
        date,
        start_time: startTime || null,
        conditions,
        tires,
        suspension,
        alignment: alignmentData,
        extra_modules: extraModules,
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
      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Session Info</span>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-zinc-300">Vehicle</label>
          <select
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            required
          >
            <option value="" disabled>
              Select a vehicle
            </option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nickname}
              </option>
            ))}
          </select>
        </div>

        <div className="relative space-y-1">
          <label className="block text-sm font-medium text-zinc-300">Track</label>
          <input
            type="text"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400 focus:outline-none"
            placeholder="Search or type a track name"
            value={trackQuery}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(e) => handleTrackInputChange(e.target.value)}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          />
          {showDropdown && filteredTracks.length > 0 ? (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg">
              {filteredTracks.map((track) => (
                <li key={track.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                    onMouseDown={() => handleTrackSelect(track)}
                  >
                    <span className="font-medium">{track.name}</span>
                    {track.location ? <span className="ml-1 text-zinc-500">{track.location}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Input label="Start Time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Conditions</span>
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

      <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Tires</span>

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
          <Input label="Brand" type="text" placeholder="e.g. Pirelli" value={frontTire.brand} onChange={(e) => setFrontTire({ ...frontTire, brand: e.target.value })} autoComplete="off" autoCorrect="off" autoCapitalize="off" />
          <Input label="Compound" type="text" placeholder="e.g. SC2" value={frontTire.compound} onChange={(e) => setFrontTire({ ...frontTire, compound: e.target.value })} autoComplete="off" autoCorrect="off" autoCapitalize="off" />
          <Input label="Pressure" type="text" inputMode="numeric" placeholder="e.g. 32.5" value={frontTire.pressure} onChange={(e) => setFrontTire({ ...frontTire, pressure: e.target.value })} />
        </div>

        <div className="space-y-3">
          <span className="text-xs font-medium text-zinc-400">Rear</span>
          <Input label="Brand" type="text" placeholder="e.g. Pirelli" value={rearTire.brand} onChange={(e) => setRearTire({ ...rearTire, brand: e.target.value })} autoComplete="off" autoCorrect="off" autoCapitalize="off" />
          <Input label="Compound" type="text" placeholder="e.g. SC1" value={rearTire.compound} onChange={(e) => setRearTire({ ...rearTire, compound: e.target.value })} autoComplete="off" autoCorrect="off" autoCapitalize="off" />
          <Input label="Pressure" type="text" inputMode="numeric" placeholder="e.g. 28.5" value={rearTire.pressure} onChange={(e) => setRearTire({ ...rearTire, pressure: e.target.value })} />
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Suspension</span>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-400">Clicks counted for both front and rear</span>
          <div className="flex items-center gap-2">
            <InfoTooltip text="Out — rotate the adjuster fully clockwise (full hard) until it stops, then count each click as you back it out. Most common standard. In — count from fully open (full soft). Some manufacturers use this. Check your manual if unsure." />
            <div className="flex overflow-hidden rounded-lg border border-zinc-700">
              <button
                type="button"
                onClick={() => setSuspensionDirection('out')}
                className={`px-3 py-1 text-xs font-medium transition ${suspensionDirection === 'out' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
              >
                Out
              </button>
              <button
                type="button"
                onClick={() => setSuspensionDirection('in')}
                className={`px-3 py-1 text-xs font-medium transition ${suspensionDirection === 'in' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
              >
                In
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <span className="text-xs font-medium text-zinc-400">Front</span>
          <Input label="Preload" type="text" inputMode="numeric" placeholder="e.g. 5" value={frontSusp.preload} onChange={(e) => setFrontSusp({ ...frontSusp, preload: e.target.value })} />
          <Input label="Compression" type="text" inputMode="numeric" placeholder="e.g. 12" value={frontSusp.compression} onChange={(e) => setFrontSusp({ ...frontSusp, compression: e.target.value })} />
          <Input label="Rebound" type="text" inputMode="numeric" placeholder="e.g. 14" value={frontSusp.rebound} onChange={(e) => setFrontSusp({ ...frontSusp, rebound: e.target.value })} />
        </div>

        <div className="space-y-3">
          <span className="text-xs font-medium text-zinc-400">Rear</span>
          <Input label="Preload" type="text" inputMode="numeric" placeholder="e.g. 8" value={rearSusp.preload} onChange={(e) => setRearSusp({ ...rearSusp, preload: e.target.value })} />
          <Input label="Compression" type="text" inputMode="numeric" placeholder="e.g. 10" value={rearSusp.compression} onChange={(e) => setRearSusp({ ...rearSusp, compression: e.target.value })} />
          <Input label="Rebound" type="text" inputMode="numeric" placeholder="e.g. 16" value={rearSusp.rebound} onChange={(e) => setRearSusp({ ...rearSusp, rebound: e.target.value })} />
        </div>
      </div>

      {showAlignment ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Alignment</span>
          <Input label="Front Camber" type="text" inputMode="numeric" placeholder="e.g. -2.5" value={alignment.front_camber} onChange={(e) => setAlignment({ ...alignment, front_camber: e.target.value })} />
          <Input label="Rear Camber" type="text" inputMode="numeric" placeholder="e.g. -1.8" value={alignment.rear_camber} onChange={(e) => setAlignment({ ...alignment, rear_camber: e.target.value })} />
          <Input label="Front Toe" type="text" inputMode="numeric" placeholder="e.g. 0.1" value={alignment.front_toe} onChange={(e) => setAlignment({ ...alignment, front_toe: e.target.value })} />
          <Input label="Rear Toe" type="text" inputMode="numeric" placeholder="e.g. 0.2" value={alignment.rear_toe} onChange={(e) => setAlignment({ ...alignment, rear_toe: e.target.value })} />
          <Input label="Caster" type="text" inputMode="numeric" placeholder="e.g. 6.5" value={alignment.caster} onChange={(e) => setAlignment({ ...alignment, caster: e.target.value })} />
        </div>
      ) : null}

      {showGeometry ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Geometry (optional module)</span>
            <Button type="button" variant={enabledModules.geometry ? 'primary' : 'secondary'} className="min-h-10 px-3 text-xs" onClick={() => toggleModule('geometry')}>
              {enabledModules.geometry ? 'Enabled' : 'Enable'}
            </Button>
          </div>

          {enabledModules.geometry ? (
            <>
              <Button type="button" variant="secondary" className="min-h-10 w-full text-xs" onClick={() => toggleAdvanced('geometry')}>
                {showAdvancedModules.geometry ? 'Hide advanced fields' : 'Show advanced fields'}
              </Button>
              <Input label="Front Sag" type="text" inputMode="numeric" placeholder="e.g. 35mm" value={geometry.sag_front} onChange={(e) => setGeometry({ ...geometry, sag_front: e.target.value })} />
              <Input label="Rear Sag" type="text" inputMode="numeric" placeholder="e.g. 30mm" value={geometry.sag_rear} onChange={(e) => setGeometry({ ...geometry, sag_rear: e.target.value })} />
              {showAdvancedModules.geometry ? (
                <>
                  <Input label="Fork Height" type="text" inputMode="numeric" placeholder="e.g. +2mm" value={geometry.fork_height} onChange={(e) => setGeometry({ ...geometry, fork_height: e.target.value })} />
                  <Input label="Rear Ride Height" type="text" inputMode="numeric" placeholder="e.g. +1 turn" value={geometry.rear_ride_height} onChange={(e) => setGeometry({ ...geometry, rear_ride_height: e.target.value })} />
                  <Input label="Geometry Notes" type="text" placeholder="Optional notes" value={geometry.notes} onChange={(e) => setGeometry({ ...geometry, notes: e.target.value })} />
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {showDrivetrain ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Drivetrain (optional module)</span>
            <Button type="button" variant={enabledModules.drivetrain ? 'primary' : 'secondary'} className="min-h-10 px-3 text-xs" onClick={() => toggleModule('drivetrain')}>
              {enabledModules.drivetrain ? 'Enabled' : 'Enable'}
            </Button>
          </div>

          {enabledModules.drivetrain ? (
            <>
              <Button type="button" variant="secondary" className="min-h-10 w-full text-xs" onClick={() => toggleAdvanced('drivetrain')}>
                {showAdvancedModules.drivetrain ? 'Hide advanced fields' : 'Show advanced fields'}
              </Button>
              <Input label="Front Sprocket" type="text" inputMode="numeric" placeholder="e.g. 15" value={drivetrain.front_sprocket} onChange={(e) => setDrivetrain({ ...drivetrain, front_sprocket: e.target.value })} />
              <Input label="Rear Sprocket" type="text" inputMode="numeric" placeholder="e.g. 45" value={drivetrain.rear_sprocket} onChange={(e) => setDrivetrain({ ...drivetrain, rear_sprocket: e.target.value })} />
              {showAdvancedModules.drivetrain ? (
                <>
                  <Input label="Chain Length" type="text" placeholder="Optional" value={drivetrain.chain_length} onChange={(e) => setDrivetrain({ ...drivetrain, chain_length: e.target.value })} />
                  <Input label="Drivetrain Notes" type="text" placeholder="Optional notes" value={drivetrain.notes} onChange={(e) => setDrivetrain({ ...drivetrain, notes: e.target.value })} />
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {showAero ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Aero (optional module)</span>
            <Button type="button" variant={enabledModules.aero ? 'primary' : 'secondary'} className="min-h-10 px-3 text-xs" onClick={() => toggleModule('aero')}>
              {enabledModules.aero ? 'Enabled' : 'Enable'}
            </Button>
          </div>

          {enabledModules.aero ? (
            <>
              <Button type="button" variant="secondary" className="min-h-10 w-full text-xs" onClick={() => toggleAdvanced('aero')}>
                {showAdvancedModules.aero ? 'Hide advanced fields' : 'Show advanced fields'}
              </Button>
              <Input label="Wing Angle" type="text" inputMode="numeric" placeholder="e.g. 4" value={aero.wing_angle} onChange={(e) => setAero({ ...aero, wing_angle: e.target.value })} />
              {showAdvancedModules.aero ? (
                <>
                  <Input label="Splitter Setting" type="text" placeholder="Optional" value={aero.splitter_setting} onChange={(e) => setAero({ ...aero, splitter_setting: e.target.value })} />
                  <Input label="Rake" type="text" inputMode="numeric" placeholder="Optional" value={aero.rake} onChange={(e) => setAero({ ...aero, rake: e.target.value })} />
                  <Input label="Aero Notes" type="text" placeholder="Optional notes" value={aero.notes} onChange={(e) => setAero({ ...aero, notes: e.target.value })} />
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">Notes</label>
        <textarea
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400 focus:outline-none"
          rows={4}
          placeholder="Observations, lap times, what to try next..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {errorMessage ? <p className="text-sm text-rose-300">{errorMessage}</p> : null}

      <Button type="submit" fullWidth disabled={isPending}>
        {isPending ? 'Saving...' : 'Save Session'}
      </Button>
    </form>
  );
}
