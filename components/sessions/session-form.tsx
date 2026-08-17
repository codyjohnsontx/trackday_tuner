'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Clock, Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChoiceRow } from '@/components/ui/choice-row';
import { Input } from '@/components/ui/input';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { LapTimeEditor } from '@/components/sessions/lap-time-editor';
import {
  EMPTY_LAP_EDITOR_VALUE,
  commitLapEditorValue,
  lapEditorValueFrom,
  type LapEditorValue,
} from '@/lib/lap-times';
import { createSession } from '@/lib/actions/sessions';
import { clearDraft, loadDraft, saveDraft } from '@/lib/drafts';
import { todayLocalDate } from '@/lib/local-date';
import {
  MISSING_CONDITIONS_MESSAGE,
  SESSION_CONDITION_OPTIONS,
  TIRE_CONDITION_OPTIONS,
  isSessionCondition,
  normalizeTireCondition,
} from '@/lib/session-answers';
import { trackProductEvent } from '@/lib/product-events.client';
import { copyLastSessionSetup } from '@/lib/session-copy';
import {
  getAvailableSessionModules,
  getDefaultAdvancedVisibility,
  sanitizeAdvancedVisibility,
  sanitizeEnabledModules,
  sessionModuleConfigs,
} from '@/lib/session-modules';
import { useTemperatureInput, useTemperatureUnit } from '@/components/ui/temperature-display';
import {
  convertTemperatureInput,
  displayTemperatureBound,
  readTemperatureUnit,
  temperatureUnitSuffix,
  toStoredCelsius,
  type TemperatureUnit,
} from '@/lib/temperature';
import { cn } from '@/lib/utils';
import type {
  Alignment,
  ExtraModules,
  SessionAdvancedVisibility,
  SessionCondition,
  SessionEnabledModules,
  SessionModuleKey,
  Session,
  Suspension,
  SuspensionDirection,
  TireCondition,
  Tires,
  Track,
  Vehicle,
  CreateSessionLapInput,
} from '@/types';

interface SessionFormProps {
  vehicles: Vehicle[];
  tracks: Track[];
  latestSessionsByVehicle?: Record<string, Session>;
}

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
  conditions: SessionCondition | null;
  /** As typed, in `temperatureUnit`. Older drafts have no unit and were Celsius. */
  ambientTemperature?: string;
  trackTemperature?: string;
  temperatureUnit?: TemperatureUnit;
  /**
   * What drafts saved before the unit preference existed called the same two
   * fields. They were always Celsius. Read so that a rider who upgrades holding
   * a draft keeps the temperatures they typed instead of silently losing them to
   * the save effect that runs straight after this restore.
   */
  ambientTemperatureC?: string;
  trackTemperatureC?: string;
  humidityPercent: string;
  weatherCondition: string;
  surfaceCondition: string;
  tireCondition: TireCondition | null;
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
  /** Absent on drafts saved before the editor started carrying its entry boxes. */
  lapEditor?: LapEditorValue;
  laps?: CreateSessionLapInput[];
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
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
        {sessionModuleConfigs[module].label}
      </span>
      <Button
        type="button"
        variant={enabled ? 'primary' : 'secondary'}
        className="min-h-11 px-3 text-xs"
        onClick={() => onToggle(module)}
      >
        {enabled ? 'On' : 'Off'}
      </Button>
    </div>
  );
}

export function SessionForm({ vehicles, tracks, latestSessionsByVehicle = {} }: SessionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);
  const formOpenedAtRef = useRef(Date.now());
  const previousEnabledModulesRef = useRef<Pick<SessionEnabledModules, 'geometry' | 'drivetrain' | 'aero'> | null>(
    null,
  );

  const initialVehicle = vehicles.length === 1 ? vehicles[0] : null;
  const initialVehicleType = initialVehicle?.type ?? 'motorcycle';

  const [vehicleId, setVehicleId] = useState(initialVehicle?.id ?? '');
  const [trackQuery, setTrackQuery] = useState('');
  const [trackId, setTrackId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  // Seeded on mount rather than at render, because the rider's calendar day is
  // only knowable in their browser: SSR would stamp the server's day (UTC in
  // production) into the markup and hydrate over it. See lib/local-date.ts.
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [sessionNumber, setSessionNumber] = useState('');
  // Weather and tire condition start unanswered. Seeding them with a default
  // filed a claim the rider never made - see lib/session-answers.ts.
  const [conditions, setConditions] = useState<SessionCondition | null>(null);
  // Held as the rider typed it, in their unit; converted to Celsius on save.
  const [ambientTemperature, setAmbientTemperature] = useTemperatureInput();
  const [trackTemperature, setTrackTemperature] = useTemperatureInput();
  const [humidityPercent, setHumidityPercent] = useState('');
  const [weatherCondition, setWeatherCondition] = useState('');
  const [surfaceCondition, setSurfaceCondition] = useState('');
  const [tireCondition, setTireCondition] = useState<TireCondition | null>(null);
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
  const [lapEditorValue, setLapEditorValue] = useState<LapEditorValue>(EMPTY_LAP_EDITOR_VALUE);
  const [errorMessage, setErrorMessage] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const temperatureUnit = useTemperatureUnit();

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null,
    [vehicles, vehicleId],
  );
  const latestSessionForVehicle = vehicleId ? latestSessionsByVehicle[vehicleId] ?? null : null;

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

  useEffect(
    () => () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const draft = loadDraft<SessionDraft>(sessionDraftKey);
    if (!draft) {
      setDate(todayLocalDate());
      hydratedRef.current = true;
      return;
    }

    const draftVehicle = vehicles.find((vehicle) => vehicle.id === draft.vehicleId) ?? null;
    const draftVehicleType = draftVehicle?.type ?? initialVehicleType;

    setVehicleId(draft.vehicleId ?? '');
    setTrackQuery(draft.trackQuery ?? '');
    setTrackId(draft.trackId ?? null);
    setDate(draft.date || todayLocalDate());
    setStartTime(draft.startTime ?? '');
    setSessionNumber(draft.sessionNumber ?? '');
    setConditions(isSessionCondition(draft.conditions) ? draft.conditions : null);
    // A draft typed in one unit, reopened under another, is re-expressed rather
    // than reread as if the number had always meant the current unit.
    // Read from storage rather than from the hook: the hook's own effect has not
    // committed its state by the time this one runs, so it still reads Celsius.
    const draftUnit = draft.temperatureUnit ?? 'c';
    const currentUnit = readTemperatureUnit();
    const ambientText = draft.ambientTemperature ?? draft.ambientTemperatureC ?? '';
    const trackText = draft.trackTemperature ?? draft.trackTemperatureC ?? '';
    setAmbientTemperature(convertTemperatureInput(ambientText, draftUnit, currentUnit));
    setTrackTemperature(convertTemperatureInput(trackText, draftUnit, currentUnit));
    setHumidityPercent(draft.humidityPercent ?? '');
    setWeatherCondition(draft.weatherCondition ?? '');
    setSurfaceCondition(draft.surfaceCondition ?? '');
    setTireCondition(normalizeTireCondition(draft.tireCondition));
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
    setLapEditorValue(draft.lapEditor ?? lapEditorValueFrom(draft.laps ?? []));
    setDraftMessage('Draft restored from this device.');
    hydratedRef.current = true;
  }, [initialVehicleType, vehicles, setAmbientTemperature, setTrackTemperature]);

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
      ambientTemperature,
      trackTemperature,
      temperatureUnit,
      humidityPercent,
      weatherCondition,
      surfaceCondition,
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
      lapEditor: lapEditorValue,
    });
  }, [
    vehicleId,
    trackQuery,
    trackId,
    date,
    startTime,
    sessionNumber,
    conditions,
    ambientTemperature,
    trackTemperature,
    temperatureUnit,
    humidityPercent,
    weatherCondition,
    surfaceCondition,
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
    lapEditorValue,
  ]);

  useEffect(() => {
    const previous = previousEnabledModulesRef.current;
    if (previous?.geometry && !enabledModules.geometry) setGeometry(emptyGeometry);
    if (previous?.drivetrain && !enabledModules.drivetrain) setDrivetrain(emptyDrivetrain);
    if (previous?.aero && !enabledModules.aero) setAero(emptyAero);
    previousEnabledModulesRef.current = {
      geometry: enabledModules.geometry,
      drivetrain: enabledModules.drivetrain,
      aero: enabledModules.aero,
    };
  }, [enabledModules.geometry, enabledModules.drivetrain, enabledModules.aero]);

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

  function handleSessionNumberChange(value: string) {
    const digits = value.replace(/\D/g, '');
    setSessionNumber(digits ? String(Math.max(1, Number(digits))) : '');
  }

  function handleSetTimeNow() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    setStartTime(`${hours}:${minutes}`);
  }

  function handleCopyLastSetup() {
    if (!latestSessionForVehicle) return;

    const copied = copyLastSessionSetup(latestSessionForVehicle, selectedVehicleType);
    setTrackId(copied.trackId);
    setTrackQuery(copied.trackQuery);
    setConditions(copied.conditions);
    setTireCondition(copied.tireCondition);
    setFrontTire(copied.frontTire);
    setRearTire(copied.rearTire);
    setSuspensionDirection(copied.suspensionDirection);
    setFrontSusp(copied.frontSusp);
    setRearSusp(copied.rearSusp);
    setAlignment(copied.alignment);
    setEnabledModules(copied.enabledModules);
    setGeometry(copied.geometry);
    setDrivetrain(copied.drivetrain);
    setAero(copied.aero);
    setDraftMessage('Last setup copied. Date, time, session number, environment, and notes were left unchanged.');
  }

  function parseOptionalNumber(label: string, value: string, min: number, max: number): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new Error(`${label} must be between ${min} and ${max}.`);
    }
    return parsed;
  }

  /**
   * A temperature the rider typed in their unit, as the Celsius value stored.
   * The bounds are the column's, quoted back in the unit they typed in.
   */
  function parseTemperature(
    label: string,
    value: string,
    minCelsius: number,
    maxCelsius: number,
  ): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    const min = displayTemperatureBound(minCelsius, temperatureUnit);
    const max = displayTemperatureBound(maxCelsius, temperatureUnit);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new Error(`${label} must be between ${min} and ${max}${temperatureUnitSuffix(temperatureUnit)}.`);
    }
    return toStoredCelsius(parsed, temperatureUnit);
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

    // `sessions.conditions` is NOT NULL and every read surface treats it as
    // something the rider said, so an unanswered weather row blocks the save
    // rather than being filled in for them.
    if (!conditions) {
      setErrorMessage(MISSING_CONDITIONS_MESSAGE);
      return;
    }

    // Text still sitting in the lap editor's entry boxes is part of what the
    // rider is saving, so it is folded in here rather than dropped.
    const committedLaps = commitLapEditorValue(lapEditorValue);
    if (!committedLaps.ok) {
      setErrorMessage(committedLaps.error);
      return;
    }
    const laps = committedLaps.laps;

    const parsedSessionNumber = sessionNumber.trim() ? Number(sessionNumber.trim()) : null;
    if (
      parsedSessionNumber !== null &&
      (!Number.isInteger(parsedSessionNumber) || parsedSessionNumber <= 0)
    ) {
      setErrorMessage('Session number must be a whole number greater than 0.');
      return;
    }

    let parsedAmbientTemperature: number | null;
    let parsedTrackTemperature: number | null;
    let parsedHumidity: number | null;
    try {
      // Bounds are Celsius in the database and quoted in the rider's unit, so 88 F
      // is inside the range that used to reject it for being above 70.
      parsedAmbientTemperature = parseTemperature('Ambient temperature', ambientTemperature, -40, 70);
      parsedTrackTemperature = parseTemperature('Track temperature', trackTemperature, -40, 95);
      parsedHumidity = parseOptionalNumber('Humidity', humidityPercent, 0, 100);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Invalid environment value.');
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
    const trimmedWeatherCondition = weatherCondition.trim();
    const trimmedSurfaceCondition = surfaceCondition.trim();
    const hasEnvironmentData =
      parsedAmbientTemperature !== null ||
      parsedTrackTemperature !== null ||
      parsedHumidity !== null ||
      trimmedWeatherCondition.length > 0 ||
      trimmedSurfaceCondition.length > 0;

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
        environment: hasEnvironmentData
          ? {
              ambient_temperature_c: parsedAmbientTemperature,
              track_temperature_c: parsedTrackTemperature,
              humidity_percent: parsedHumidity,
              weather_condition: trimmedWeatherCondition || null,
              surface_condition: trimmedSurfaceCondition || null,
              source: 'manual',
            }
          : undefined,
        notes: notes.trim() || null,
        laps,
        capture_duration_ms: Date.now() - formOpenedAtRef.current,
      });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      clearDraft(sessionDraftKey);
      trackProductEvent('session_created', {
        session_id: result.data.id,
        vehicle_id: result.data.vehicle_id,
        properties: { capture_duration_ms: Date.now() - formOpenedAtRef.current, lap_count: laps.length },
      });
      if (laps.length > 0) {
        trackProductEvent('lap_data_saved', {
          session_id: result.data.id,
          vehicle_id: result.data.vehicle_id,
          properties: { lap_count: laps.length, source: 'session_create' },
        });
      }
      setSaved(true);
      // Hold the confirmed checkmark briefly before leaving the form. Tracked so
      // it can be cancelled on unmount and never fire a redirect after teardown.
      redirectTimerRef.current = setTimeout(() => {
        redirectTimerRef.current = null;
        router.push(`/sessions/${result.data.id}`);
        router.refresh();
      }, 700);
    });
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-3 rounded-card bg-surface p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Session Info</span>

        <div className="space-y-1">
          <label htmlFor="session-vehicle" className="block text-sm font-medium text-ink-dim">
            Vehicle
          </label>
          <select
            id="session-vehicle"
            className="w-full rounded-row bg-surface-3 px-3 py-3 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
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

        {latestSessionForVehicle ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full justify-center gap-2 text-sm"
            onClick={handleCopyLastSetup}
          >
            <Copy className="h-4 w-4" aria-hidden />
            Copy last setup
          </Button>
        ) : null}

        <div className="relative space-y-1">
          <label htmlFor="session-track" className="block text-sm font-medium text-ink-dim">
            Track
          </label>
          <input
            id="session-track"
            type="text"
            className="w-full rounded-row bg-surface-3 px-3 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
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
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-row bg-surface-2 shadow-lg">
              {filteredTracks.map((track) => (
                <li key={track.id}>
                  <button
                    type="button"
                    className="min-h-11 w-full px-3 py-3 text-left text-sm text-ink hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-signal/80"
                    onMouseDown={() => handleTrackSelect(track)}
                  >
                    <span className="font-medium">{track.name}</span>
                    {track.location ? <span className="ml-1 text-ink-faint">{track.location}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <Input label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Input label="Start Time" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 justify-center gap-2 px-3 text-sm"
            onClick={handleSetTimeNow}
          >
            <Clock className="h-4 w-4" aria-hidden />
            Now
          </Button>
        </div>
        <Input
          label="Session Number (optional)"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="e.g. 3"
          value={sessionNumber}
          onChange={(event) => handleSessionNumberChange(event.target.value)}
        />
      </div>

      <div className="space-y-3 rounded-card bg-surface p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Conditions</span>
        <ChoiceRow
          label="Weather"
          options={SESSION_CONDITION_OPTIONS}
          value={conditions}
          onChange={setConditions}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label={`Ambient Temp (${temperatureUnitSuffix(temperatureUnit)})`}
            type="number"
            inputMode="decimal"
            step="any"
            placeholder={temperatureUnit === 'f' ? '75' : '24'}
            value={ambientTemperature}
            onChange={(event) => setAmbientTemperature(event.target.value)}
          />
          <Input
            label={`Track Temp (${temperatureUnitSuffix(temperatureUnit)})`}
            type="number"
            inputMode="decimal"
            step="any"
            placeholder={temperatureUnit === 'f' ? '97' : '36'}
            value={trackTemperature}
            onChange={(event) => setTrackTemperature(event.target.value)}
          />
          <Input
            label="Humidity (%)"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="55"
            value={humidityPercent}
            onChange={(event) => setHumidityPercent(event.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Weather Detail"
            type="text"
            placeholder="Warming, light wind"
            value={weatherCondition}
            onChange={(event) => setWeatherCondition(event.target.value)}
          />
          <Input
            label="Surface"
            type="text"
            placeholder="Green, rubbered in, dusty"
            value={surfaceCondition}
            onChange={(event) => setSurfaceCondition(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-card bg-surface p-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Modules</span>
          <p className="mt-1 text-sm text-ink-dim">
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
                className="min-h-11 justify-between px-3 text-xs"
                onClick={() => toggleModule(module as ModuleToggleKey)}
              >
                <span>{sessionModuleConfigs[module].label}</span>
                <span>{enabledModules[module] ? 'On' : 'Off'}</span>
              </Button>
            ))}
        </div>
      </div>

      {enabledModules.tires ? (
        <div className="space-y-4 rounded-card bg-surface p-4">
          <ModuleHeader module="tires" enabled={enabledModules.tires} onToggle={toggleModule} />

          <div className="space-y-2">
            <span className="text-xs font-medium text-ink-dim">Condition</span>
            <ChoiceRow
              label="Tire condition"
              options={TIRE_CONDITION_OPTIONS}
              value={tireCondition}
              onChange={setTireCondition}
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full text-xs"
            onClick={() => toggleAdvanced('tires')}
          >
            {showAdvancedModules.tires ? 'Hide tire details' : sessionModuleConfigs.tires.advancedLabel}
          </Button>

          <div className="space-y-3">
            <span className="text-xs font-medium text-ink-dim">Front</span>
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
            <span className="text-xs font-medium text-ink-dim">Rear</span>
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
        <div className="space-y-4 rounded-card bg-surface p-4">
          <ModuleHeader module="suspension" enabled={enabledModules.suspension} onToggle={toggleModule} />

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink-dim">Clicks counted for both front and rear</span>
            <div className="flex items-center gap-2">
              <InfoTooltip text="Out - rotate the adjuster fully clockwise (full hard) until it stops, then count each click as you back it out. Most common standard. In - count from fully open (full soft). Some manufacturers use this. Check your manual if unsure." />
              <div className="flex overflow-hidden rounded-plate border border-white/10">
                <button
                  type="button"
                  onClick={() => setSuspensionDirection('out')}
                  className={cn(
                    'min-h-11 px-3 py-2 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-signal/80',
                    suspensionDirection === 'out'
                      ? 'bg-ink text-canvas'
                      : 'bg-surface text-ink-dim hover:text-ink',
                  )}
                >
                  Out
                </button>
                <button
                  type="button"
                  onClick={() => setSuspensionDirection('in')}
                  className={cn(
                    'min-h-11 px-3 py-2 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-signal/80',
                    suspensionDirection === 'in'
                      ? 'bg-ink text-canvas'
                      : 'bg-surface text-ink-dim hover:text-ink',
                  )}
                >
                  In
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <span className="text-xs font-medium text-ink-dim">Front</span>
            <Input label="Front Preload" type="text" inputMode="numeric" placeholder="e.g. 5" value={frontSusp.preload} onChange={(event) => setFrontSusp({ ...frontSusp, preload: event.target.value })} />
            <Input label="Front Compression" type="text" inputMode="numeric" placeholder="e.g. 12" value={frontSusp.compression} onChange={(event) => setFrontSusp({ ...frontSusp, compression: event.target.value })} />
            <Input label="Front Rebound" type="text" inputMode="numeric" placeholder="e.g. 14" value={frontSusp.rebound} onChange={(event) => setFrontSusp({ ...frontSusp, rebound: event.target.value })} />
          </div>

          <div className="space-y-3">
            <span className="text-xs font-medium text-ink-dim">Rear</span>
            <Input label="Rear Preload" type="text" inputMode="numeric" placeholder="e.g. 8" value={rearSusp.preload} onChange={(event) => setRearSusp({ ...rearSusp, preload: event.target.value })} />
            <Input label="Rear Compression" type="text" inputMode="numeric" placeholder="e.g. 10" value={rearSusp.compression} onChange={(event) => setRearSusp({ ...rearSusp, compression: event.target.value })} />
            <Input label="Rear Rebound" type="text" inputMode="numeric" placeholder="e.g. 16" value={rearSusp.rebound} onChange={(event) => setRearSusp({ ...rearSusp, rebound: event.target.value })} />
          </div>
        </div>
      ) : null}

      {availableModules.includes('alignment') && enabledModules.alignment ? (
        <div className="space-y-3 rounded-card bg-surface p-4">
          <ModuleHeader module="alignment" enabled={enabledModules.alignment} onToggle={toggleModule} />
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full text-xs"
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
        <div className="space-y-3 rounded-card bg-surface p-4">
          <ModuleHeader module="geometry" enabled={enabledModules.geometry} onToggle={toggleModule} />
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full text-xs"
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
        <div className="space-y-3 rounded-card bg-surface p-4">
          <ModuleHeader module="drivetrain" enabled={enabledModules.drivetrain} onToggle={toggleModule} />
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full text-xs"
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
        <div className="space-y-3 rounded-card bg-surface p-4">
          <ModuleHeader module="aero" enabled={enabledModules.aero} onToggle={toggleModule} />
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full text-xs"
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

      <LapTimeEditor value={lapEditorValue} onChange={setLapEditorValue} />

      <div className="space-y-2 rounded-card bg-surface p-4">
        <label htmlFor="session-notes" className="block text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Notes
        </label>
        <textarea
          id="session-notes"
          className="w-full rounded-row bg-surface-3 px-3 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          rows={4}
          placeholder="Observations, lap times, what to try next..."
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {errorMessage ? <p className="text-sm text-slower">{errorMessage}</p> : null}
      {draftMessage ? <p className="text-sm text-faster">{draftMessage}</p> : null}

      <div className="sticky bottom-20 z-20 rounded-card bg-surface-3 p-2 shadow-lg shadow-black backdrop-blur sm:bottom-4">
        <Button type="submit" fullWidth disabled={isPending || saved} loading={isPending} success={saved}>
          {saved ? 'Saved' : isPending ? 'Saving…' : 'Save Session'}
        </Button>
      </div>
    </form>
  );
}
