'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { createSession } from '@/lib/actions/sessions';
import { clearDraft, loadDraft, saveDraft } from '@/lib/drafts';
import {
  getAvailableSessionModules,
  getDefaultAdvancedVisibility,
  sanitizeAdvancedVisibility,
  sanitizeEnabledModules,
  sessionModuleConfigs,
} from '@/lib/session-modules';
import type {
  Alignment,
  ExtraModules,
  SessionAdvancedVisibility,
  SessionCondition,
  SessionEnabledModules,
  SessionModuleKey,
  Suspension,
  SuspensionDirection,
  TireCondition,
  Tires,
  Track,
  Vehicle,
} from '@/types';

interface SessionFormProps {
  vehicles: Vehicle[];
  tracks: Track[];
}

const today = new Date().toISOString().split('T')[0];
const sessionDraftKey = 'session_form_new';

const emptyTireEnd = { brand: '', compound: '', pressure: '' };
const emptySuspEnd = { preload: '', compression: '', rebound: '' };
const emptyAlignment: Alignment = {
  front_camber: '',
  rear_camber: '',
  front_toe: '',
  rear_toe: '',
  caster: '',
};
const emptyGeometry = {
  sag_front: '',
  sag_rear: '',
  fork_height: '',
  rear_ride_height: '',
  notes: '',
};
const emptyDrivetrain = {
  front_sprocket: '',
  rear_sprocket: '',
  chain_length: '',
  notes: '',
};
const emptyAero = {
  wing_angle: '',
  splitter_setting: '',
  rake: '',
  notes: '',
};

type ModuleToggleKey = Exclude<SessionModuleKey, 'notes'>;

interface SessionDraft {
  vehicleId: string;
  trackQuery: string;
  trackId: string | null;
  date: string;
  startTime: string;
  sessionNumber: string;
  conditions: SessionCondition;
  tireCondition: TireCondition;
  frontTire: typeof emptyTireEnd;
  rearTire: typeof emptyTireEnd;
  suspensionDirection: SuspensionDirection;
  frontSusp: typeof emptySuspEnd;
  rearSusp: typeof emptySuspEnd;
  alignment: Alignment;
  enabledModules: SessionEnabledModules;
  showAdvancedModules: SessionAdvancedVisibility;
  geometry: typeof emptyGeometry;
  drivetrain: typeof emptyDrivetrain;
  aero: typeof emptyAero;
  notes: string;
}

function ModuleHeader({
  module,
  enabled,
  onToggle,
}: {
  module: ModuleToggleKey;
  enabled: boolean;
  onToggle: (module: ModuleToggleKey) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {sessionModuleConfigs[module].label}
      </span>
      <Button
        type="button"
        variant={enabled ? 'primary' : 'secondary'}
        className="min-h-10 px-3 text-xs"
        onClick={() => onToggle(module)}
      >
        {enabled ? 'On' : 'Off'}
      </Button>
    </div>
  );
}

export function SessionForm({ vehicles, tracks }: SessionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const hydratedRef = useRef(false);

  const initialVehicle = vehicles.length === 1 ? vehicles[0] : null;
  const initialVehicleType = initialVehicle?.type ?? 'motorcycle';

  const [vehicleId, setVehicleId] = useState(initialVehicle?.id ?? '');
  const [trackQuery, setTrackQuery] = useState('');
  const [trackId, setTrackId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState('');
  const [sessionNumber, setSessionNumber] = useState('');
  const [conditions, setConditions] = useState<SessionCondition>('sunny');
  const [tireCondition, setTireCondition] = useState<TireCondition>('scrubbed');
  const [frontTire, setFrontTire] = useState(emptyTireEnd);
  const [rearTire, setRearTire] = useState(emptyTireEnd);
  const [suspensionDirection, setSuspensionDirection] = useState<SuspensionDirection>('out');
  const [frontSusp, setFrontSusp] = useState(emptySuspEnd);
  const [rearSusp, setRearSusp] = useState(emptySuspEnd);
  const [alignment, setAlignment] = useState<Alignment>(emptyAlignment);
  const [enabledModules, setEnabledModules] = useState<SessionEnabledModules>(
    sanitizeEnabledModules(initialVehicleType, null)
  );
  const [showAdvancedModules, setShowAdvancedModules] = useState<SessionAdvancedVisibility>(
    getDefaultAdvancedVisibility()
  );
  const [geometry, setGeometry] = useState(emptyGeometry);
  const [drivetrain, setDrivetrain] = useState(emptyDrivetrain);
  const [aero, setAero] = useState(emptyAero);
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [draftMessage, setDraftMessage] = useState('');

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null,
    [vehicles, vehicleId],
  );

  const selectedVehicleType = selectedVehicle?.type ?? initialVehicleType;
  const availableModules = useMemo(
    () => getAvailableSessionModules(selectedVehicleType),
    [selectedVehicleType],
  );

  const filteredTracks = useMemo(() => {
    const query = trackQuery.trim().toLowerCase();
    if (!query) return tracks;
    return tracks.filter((track) => track.name.toLowerCase().includes(query));
  }, [tracks, trackQuery]);

  useEffect(() => {
    setEnabledModules((current) => sanitizeEnabledModules(selectedVehicleType, current));
    setShowAdvancedModules((current) => sanitizeAdvancedVisibility(selectedVehicleType, current));
  }, [selectedVehicleType]);

  useEffect(() => {
    const draft = loadDraft<SessionDraft>(sessionDraftKey);
    if (!draft) {
      hydratedRef.current = true;
      return;
    }

    const draftVehicle = vehicles.find((vehicle) => vehicle.id === draft.vehicleId) ?? null;
    const draftVehicleType = draftVehicle?.type ?? initialVehicleType;

    setVehicleId(draft.vehicleId ?? '');
    setTrackQuery(draft.trackQuery ?? '');
    setTrackId(draft.trackId ?? null);
    setDate(draft.date ?? today);
    setStartTime(draft.startTime ?? '');
    setSessionNumber(draft.sessionNumber ?? '');
    setConditions(draft.conditions ?? 'sunny');
    setTireCondition(draft.tireCondition ?? 'scrubbed');
    setFrontTire(draft.frontTire ?? emptyTireEnd);
    setRearTire(draft.rearTire ?? emptyTireEnd);
    setSuspensionDirection(draft.suspensionDirection ?? 'out');
    setFrontSusp(draft.frontSusp ?? emptySuspEnd);
    setRearSusp(draft.rearSusp ?? emptySuspEnd);
    setAlignment(draft.alignment ?? emptyAlignment);
    setEnabledModules(sanitizeEnabledModules(draftVehicleType, draft.enabledModules));
    setShowAdvancedModules(sanitizeAdvancedVisibility(draftVehicleType, draft.showAdvancedModules));
    setGeometry(draft.geometry ?? emptyGeometry);
    setDrivetrain(draft.drivetrain ?? emptyDrivetrain);
    setAero(draft.aero ?? emptyAero);
    setNotes(draft.notes ?? '');
    setDraftMessage('Draft restored from this device.');
    hydratedRef.current = true;
  }, [initialVehicleType, vehicles]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    saveDraft(sessionDraftKey, {
      vehicleId,
      trackQuery,
      trackId,
      date,
      startTime,
      sessionNumber,
      conditions,
      tireCondition,
      frontTire,
      rearTire,
      suspensionDirection,
      frontSusp,
      rearSusp,
      alignment,
      enabledModules,
      showAdvancedModules,
      geometry,
      drivetrain,
      aero,
      notes,
    });
  }, [
    vehicleId,
    trackQuery,
    trackId,
    date,
    startTime,
    sessionNumber,
    conditions,
    tireCondition,
    frontTire,
    rearTire,
    suspensionDirection,
    frontSusp,
    rearSusp,
    alignment,
    enabledModules,
    showAdvancedModules,
    geometry,
    drivetrain,
    aero,
    notes,
  ]);

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

  function toggleModule(module: ModuleToggleKey) {
    setEnabledModules((current) => {
      const next = { ...current, [module]: !current[module] };
      return sanitizeEnabledModules(selectedVehicleType, next);
    });
  }

  function toggleAdvanced(module: SessionModuleKey) {
    setShowAdvancedModules((current) => ({
      ...current,
      [module]: !current[module],
    }));
  }

  function buildExtraModules(modules: SessionEnabledModules): ExtraModules | null {
    const result: ExtraModules = {};

    if (modules.geometry) {
      result.geometry = { ...geometry };
    }

    if (modules.drivetrain) {
      result.drivetrain = { ...drivetrain };
    }

    if (modules.aero) {
      result.aero = { ...aero };
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

    const parsedSessionNumber = sessionNumber.trim() ? Number(sessionNumber.trim()) : null;
    if (
      parsedSessionNumber !== null &&
      (!Number.isInteger(parsedSessionNumber) || parsedSessionNumber <= 0)
    ) {
      setErrorMessage('Session number must be a whole number greater than 0.');
      return;
    }

    const sanitizedModules = sanitizeEnabledModules(selectedVehicleType, enabledModules);

    const tires: Tires = {
      front: frontTire,
      rear: rearTire,
      condition: tireCondition,
    };

    const suspension: Suspension = {
      front: { ...frontSusp, direction: suspensionDirection },
      rear: { ...rearSusp, direction: suspensionDirection },
    };

    const alignmentData: Alignment | null =
      selectedVehicleType === 'car' && sanitizedModules.alignment ? alignment : null;
    const extraModules = buildExtraModules(sanitizedModules);

    startTransition(async () => {
      const result = await createSession({
        vehicle_id: vehicleId,
        track_id: trackId,
        track_name: trackQuery.trim() || null,
        date,
        start_time: startTime || null,
        session_number: parsedSessionNumber,
        conditions,
        tires,
        suspension,
        alignment: alignmentData,
        enabled_modules: sanitizedModules,
        extra_modules: extraModules,
        notes: notes.trim() || null,
      });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      clearDraft(sessionDraftKey);
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
          <label htmlFor="session-vehicle" className="block text-sm font-medium text-zinc-300">
            Vehicle
          </label>
          <select
            id="session-vehicle"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none"
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            required
          >
            <option value="" disabled>
              Select a vehicle
            </option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.nickname}
              </option>
            ))}
          </select>
        </div>

        <div className="relative space-y-1">
          <label htmlFor="session-track" className="block text-sm font-medium text-zinc-300">
            Track
          </label>
          <input
            id="session-track"
            type="text"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400 focus:outline-none"
            placeholder="Search or type a track name"
            value={trackQuery}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => handleTrackInputChange(event.target.value)}
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

        <Input label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        <Input label="Start Time" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        <Input
          label="Session Number (optional)"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 3"
          value={sessionNumber}
          onChange={(event) => setSessionNumber(event.target.value)}
        />
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Conditions</span>
        <div className="grid grid-cols-4 gap-2 rounded-xl bg-zinc-950 p-1">
          {conditionOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={conditions === option.value ? 'primary' : 'secondary'}
              className="min-h-10 px-1 text-xs"
              onClick={() => setConditions(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Modules</span>
          <p className="mt-1 text-sm text-zinc-400">
            Start with the basics. Turn on extra modules only for the data you want to log this session.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {availableModules
            .filter((module) => module !== 'notes')
            .map((module) => (
              <Button
                key={module}
                type="button"
                variant={enabledModules[module] ? 'primary' : 'secondary'}
                className="justify-between px-3 text-xs"
                onClick={() => toggleModule(module as ModuleToggleKey)}
              >
                <span>{sessionModuleConfigs[module].label}</span>
                <span>{enabledModules[module] ? 'On' : 'Off'}</span>
              </Button>
            ))}
        </div>
      </div>

      {enabledModules.tires ? (
        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <ModuleHeader module="tires" enabled={enabledModules.tires} onToggle={toggleModule} />

          <div className="space-y-2">
            <span className="text-xs font-medium text-zinc-400">Condition</span>
            <div className="grid grid-cols-4 gap-2 rounded-xl bg-zinc-950 p-1">
              {tireConditionOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={tireCondition === option.value ? 'primary' : 'secondary'}
                  className="min-h-10 px-1 text-xs"
                  onClick={() => setTireCondition(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            className="min-h-10 w-full text-xs"
            onClick={() => toggleAdvanced('tires')}
          >
            {showAdvancedModules.tires ? 'Hide tire details' : sessionModuleConfigs.tires.advancedLabel}
          </Button>

          <div className="space-y-3">
            <span className="text-xs font-medium text-zinc-400">Front</span>
            <Input
              label="Front Pressure"
              type="text"
              inputMode="decimal"
              placeholder="e.g. 32.5"
              value={frontTire.pressure}
              onChange={(event) => setFrontTire({ ...frontTire, pressure: event.target.value })}
            />
            {showAdvancedModules.tires ? (
              <>
                <Input
                  label="Front Brand"
                  type="text"
                  placeholder="e.g. Pirelli"
                  value={frontTire.brand}
                  onChange={(event) => setFrontTire({ ...frontTire, brand: event.target.value })}
                  autoComplete="off"
                />
                <Input
                  label="Front Compound"
                  type="text"
                  placeholder="e.g. SC2"
                  value={frontTire.compound}
                  onChange={(event) => setFrontTire({ ...frontTire, compound: event.target.value })}
                  autoComplete="off"
                />
              </>
            ) : null}
          </div>

          <div className="space-y-3">
            <span className="text-xs font-medium text-zinc-400">Rear</span>
            <Input
              label="Rear Pressure"
              type="text"
              inputMode="decimal"
              placeholder="e.g. 28.5"
              value={rearTire.pressure}
              onChange={(event) => setRearTire({ ...rearTire, pressure: event.target.value })}
            />
            {showAdvancedModules.tires ? (
              <>
                <Input
                  label="Rear Brand"
                  type="text"
                  placeholder="e.g. Pirelli"
                  value={rearTire.brand}
                  onChange={(event) => setRearTire({ ...rearTire, brand: event.target.value })}
                  autoComplete="off"
                />
                <Input
                  label="Rear Compound"
                  type="text"
                  placeholder="e.g. SC1"
                  value={rearTire.compound}
                  onChange={(event) => setRearTire({ ...rearTire, compound: event.target.value })}
                  autoComplete="off"
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {enabledModules.suspension ? (
        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <ModuleHeader module="suspension" enabled={enabledModules.suspension} onToggle={toggleModule} />

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">Clicks counted for both front and rear</span>
            <div className="flex items-center gap-2">
              <InfoTooltip text="Out - rotate the adjuster fully clockwise (full hard) until it stops, then count each click as you back it out. Most common standard. In - count from fully open (full soft). Some manufacturers use this. Check your manual if unsure." />
              <div className="flex overflow-hidden rounded-lg border border-zinc-700">
                <button
                  type="button"
                  onClick={() => setSuspensionDirection('out')}
                  className={`px-3 py-1 text-xs font-medium transition ${
                    suspensionDirection === 'out'
                      ? 'bg-cyan-400 text-zinc-950'
                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Out
                </button>
                <button
                  type="button"
                  onClick={() => setSuspensionDirection('in')}
                  className={`px-3 py-1 text-xs font-medium transition ${
                    suspensionDirection === 'in'
                      ? 'bg-cyan-400 text-zinc-950'
                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  In
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <span className="text-xs font-medium text-zinc-400">Front</span>
            <Input label="Front Preload" type="text" inputMode="numeric" placeholder="e.g. 5" value={frontSusp.preload} onChange={(event) => setFrontSusp({ ...frontSusp, preload: event.target.value })} />
            <Input label="Front Compression" type="text" inputMode="numeric" placeholder="e.g. 12" value={frontSusp.compression} onChange={(event) => setFrontSusp({ ...frontSusp, compression: event.target.value })} />
            <Input label="Front Rebound" type="text" inputMode="numeric" placeholder="e.g. 14" value={frontSusp.rebound} onChange={(event) => setFrontSusp({ ...frontSusp, rebound: event.target.value })} />
          </div>

          <div className="space-y-3">
            <span className="text-xs font-medium text-zinc-400">Rear</span>
            <Input label="Rear Preload" type="text" inputMode="numeric" placeholder="e.g. 8" value={rearSusp.preload} onChange={(event) => setRearSusp({ ...rearSusp, preload: event.target.value })} />
            <Input label="Rear Compression" type="text" inputMode="numeric" placeholder="e.g. 10" value={rearSusp.compression} onChange={(event) => setRearSusp({ ...rearSusp, compression: event.target.value })} />
            <Input label="Rear Rebound" type="text" inputMode="numeric" placeholder="e.g. 16" value={rearSusp.rebound} onChange={(event) => setRearSusp({ ...rearSusp, rebound: event.target.value })} />
          </div>
        </div>
      ) : null}

      {availableModules.includes('alignment') && enabledModules.alignment ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <ModuleHeader module="alignment" enabled={enabledModules.alignment} onToggle={toggleModule} />
          <Button
            type="button"
            variant="secondary"
            className="min-h-10 w-full text-xs"
            onClick={() => toggleAdvanced('alignment')}
          >
            {showAdvancedModules.alignment ? 'Hide advanced fields' : 'Show advanced fields'}
          </Button>
          <Input label="Front Camber" type="text" inputMode="decimal" placeholder="e.g. -2.5" value={alignment.front_camber} onChange={(event) => setAlignment({ ...alignment, front_camber: event.target.value })} />
          <Input label="Rear Camber" type="text" inputMode="decimal" placeholder="e.g. -1.8" value={alignment.rear_camber} onChange={(event) => setAlignment({ ...alignment, rear_camber: event.target.value })} />
          <Input label="Front Toe" type="text" inputMode="decimal" placeholder="e.g. 0.1" value={alignment.front_toe} onChange={(event) => setAlignment({ ...alignment, front_toe: event.target.value })} />
          <Input label="Rear Toe" type="text" inputMode="decimal" placeholder="e.g. 0.2" value={alignment.rear_toe} onChange={(event) => setAlignment({ ...alignment, rear_toe: event.target.value })} />
          {showAdvancedModules.alignment ? (
            <Input label="Caster" type="text" inputMode="decimal" placeholder="e.g. 6.5" value={alignment.caster} onChange={(event) => setAlignment({ ...alignment, caster: event.target.value })} />
          ) : null}
        </div>
      ) : null}

      {availableModules.includes('geometry') && enabledModules.geometry ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <ModuleHeader module="geometry" enabled={enabledModules.geometry} onToggle={toggleModule} />
          <Button
            type="button"
            variant="secondary"
            className="min-h-10 w-full text-xs"
            onClick={() => toggleAdvanced('geometry')}
          >
            {showAdvancedModules.geometry ? 'Hide advanced fields' : 'Show advanced fields'}
          </Button>
          <Input label="Front Sag" type="text" inputMode="decimal" placeholder="e.g. 35" value={geometry.sag_front} onChange={(event) => setGeometry({ ...geometry, sag_front: event.target.value })} />
          <Input label="Rear Sag" type="text" inputMode="decimal" placeholder="e.g. 30" value={geometry.sag_rear} onChange={(event) => setGeometry({ ...geometry, sag_rear: event.target.value })} />
          {showAdvancedModules.geometry ? (
            <>
              <Input label="Fork Height" type="text" inputMode="decimal" placeholder="e.g. +2" value={geometry.fork_height} onChange={(event) => setGeometry({ ...geometry, fork_height: event.target.value })} />
              <Input label="Rear Ride Height" type="text" inputMode="decimal" placeholder="e.g. +1 turn" value={geometry.rear_ride_height} onChange={(event) => setGeometry({ ...geometry, rear_ride_height: event.target.value })} />
              <Input label="Geometry Notes" type="text" placeholder="Optional notes" value={geometry.notes} onChange={(event) => setGeometry({ ...geometry, notes: event.target.value })} />
            </>
          ) : null}
        </div>
      ) : null}

      {availableModules.includes('drivetrain') && enabledModules.drivetrain ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <ModuleHeader module="drivetrain" enabled={enabledModules.drivetrain} onToggle={toggleModule} />
          <Button
            type="button"
            variant="secondary"
            className="min-h-10 w-full text-xs"
            onClick={() => toggleAdvanced('drivetrain')}
          >
            {showAdvancedModules.drivetrain ? 'Hide advanced fields' : 'Show advanced fields'}
          </Button>
          <Input label="Front Sprocket" type="text" inputMode="numeric" placeholder="e.g. 15" value={drivetrain.front_sprocket} onChange={(event) => setDrivetrain({ ...drivetrain, front_sprocket: event.target.value })} />
          <Input label="Rear Sprocket" type="text" inputMode="numeric" placeholder="e.g. 45" value={drivetrain.rear_sprocket} onChange={(event) => setDrivetrain({ ...drivetrain, rear_sprocket: event.target.value })} />
          {showAdvancedModules.drivetrain ? (
            <>
              <Input label="Chain Length" type="text" placeholder="Optional" value={drivetrain.chain_length} onChange={(event) => setDrivetrain({ ...drivetrain, chain_length: event.target.value })} />
              <Input label="Drivetrain Notes" type="text" placeholder="Optional notes" value={drivetrain.notes} onChange={(event) => setDrivetrain({ ...drivetrain, notes: event.target.value })} />
            </>
          ) : null}
        </div>
      ) : null}

      {availableModules.includes('aero') && enabledModules.aero ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <ModuleHeader module="aero" enabled={enabledModules.aero} onToggle={toggleModule} />
          <Button
            type="button"
            variant="secondary"
            className="min-h-10 w-full text-xs"
            onClick={() => toggleAdvanced('aero')}
          >
            {showAdvancedModules.aero ? 'Hide advanced fields' : 'Show advanced fields'}
          </Button>
          <Input label="Wing Angle" type="text" inputMode="decimal" placeholder="e.g. 4" value={aero.wing_angle} onChange={(event) => setAero({ ...aero, wing_angle: event.target.value })} />
          {showAdvancedModules.aero ? (
            <>
              <Input label="Splitter Setting" type="text" placeholder="Optional" value={aero.splitter_setting} onChange={(event) => setAero({ ...aero, splitter_setting: event.target.value })} />
              <Input label="Rake" type="text" inputMode="decimal" placeholder="Optional" value={aero.rake} onChange={(event) => setAero({ ...aero, rake: event.target.value })} />
              <Input label="Aero Notes" type="text" placeholder="Optional notes" value={aero.notes} onChange={(event) => setAero({ ...aero, notes: event.target.value })} />
            </>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <label htmlFor="session-notes" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Notes
        </label>
        <textarea
          id="session-notes"
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400 focus:outline-none"
          rows={4}
          placeholder="Observations, lap times, what to try next..."
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {errorMessage ? <p className="text-sm text-rose-300">{errorMessage}</p> : null}
      {draftMessage ? <p className="text-sm text-emerald-300">{draftMessage}</p> : null}

      <Button type="submit" fullWidth disabled={isPending}>
        {isPending ? 'Saving...' : 'Save Session'}
      </Button>
    </form>
  );
}
