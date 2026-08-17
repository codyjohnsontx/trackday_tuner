'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import type { AdviceResponse } from '@/lib/rag/schema';
import type { Vehicle } from '@/types';
import { cn } from '@/lib/utils';
import { useTemperatureUnit } from '@/components/ui/temperature-display';
import { temperatureUnitSuffix, toStoredCelsius } from '@/lib/temperature';

interface DayPlanPanelProps {
  vehicles: Vehicle[];
  tier: 'free' | 'pro';
  demoMode?: boolean;
}

interface DayPlanSuccess {
  ok: true;
  request_id: string;
  advice: AdviceResponse;
}

interface DayPlanError {
  ok: false;
  error: string;
  request_id?: string;
}

type DayPlanResponse = DayPlanSuccess | DayPlanError;

const DATA_USED_LABELS: Record<string, string> = {
  manual: 'Manual Input',
  weather: 'Weather Data',
  history: 'Session History',
  feedback: 'Past Feedback',
  lap_data: 'Lap Data',
  telemetry: 'Telemetry',
};

function getLocalIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDayPlanSuccess(value: DayPlanResponse): value is DayPlanSuccess {
  return (
    value.ok === true &&
    typeof value.request_id === 'string' &&
    !!value.advice &&
    typeof value.advice === 'object' &&
    Array.isArray(value.advice.recommended_changes) &&
    !!value.advice.data_used &&
    typeof value.advice.data_used === 'object' &&
    !Array.isArray(value.advice.data_used) &&
    typeof value.advice.summary === 'string' &&
    typeof value.advice.confidence === 'string'
  );
}

const demoDayPlanAdvice: AdviceResponse = {
  summary:
    'Start from the Session 3 baseline because it recovered front feel without adding another geometry variable. Expect rear grip to fall off as track temperature climbs.',
  recommended_changes: [
    {
      component: 'Tire pressures',
      direction: 'Monitor rear hot pressure',
      magnitude: 'Bleed back toward 26 psi hot if it climbs above target',
      reason: 'The hottest demo session lost exit drive as rear pressure and track temperature rose together.',
    },
    {
      component: 'Front damping',
      direction: 'Keep Session 3 setting',
      magnitude: 'Do not add rebound until the front push returns',
      reason: 'Session 2 combined more front pressure with more rebound and felt worse mid-corner.',
    },
  ],
  tradeoffs: ['Chasing rear grip with pressure may reduce carcass support if taken too far.'],
  confidence: 'medium',
  safety_notes: ['Make one change at a time and verify tire pressures with a reliable gauge.'],
  citations: [],
  prediction: {
    expected_effect: 'The bike should keep the improved turn-in from Session 3 while reducing late-session rear greasiness.',
    day_trend: 'Track temperature is the main watch item as the day heats up.',
    watch_items: ['Rear drive after lap four', 'Front push through long right-handers'],
  },
  personal_evidence: [
    {
      label: 'Session 3',
      detail: 'Lower front pressure and softer compression improved turn-in and front compliance.',
      source_session_id: 'demo-session-3',
    },
  ],
  data_used: {
    manual: true,
    weather: true,
    history: true,
    feedback: false,
    lap_data: false,
    telemetry: false,
  },
  refusal: null,
};

export function DayPlanPanel({ vehicles, tier, demoMode = false }: DayPlanPanelProps) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [trackName, setTrackName] = useState('');
  // Typed in the rider's unit; the route stores and reasons in Celsius.
  const [ambientTemperature, setAmbientTemperature] = useState('');
  const [trackTemperature, setTrackTemperature] = useState('');
  const temperatureUnit = useTemperatureUnit();
  const [weatherCondition, setWeatherCondition] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<DayPlanSuccess | null>(null);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null,
    [vehicleId, vehicles],
  );

  useEffect(() => {
    if (vehicles.some((vehicle) => vehicle.id === vehicleId)) return;
    setVehicleId(vehicles[0]?.id ?? '');
  }, [vehicleId, vehicles]);

  if (vehicles.length === 0) return null;

  if (!demoMode && tier !== 'pro') {
    return (
      <section className="rounded-card bg-surface p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Morning Plan</h2>
        <p className="mt-2 text-sm text-ink-dim">
          Pro unlocks forecast-aware Race Engineer planning from your past sessions.
        </p>
        <div className="mt-4">
          <UpgradeToProButton fullWidth />
        </div>
      </section>
    );
  }

  function parseOptionalNumber(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demoMode) return;

    setError('');
    setResponse(null);

    if (!vehicleId) {
      setError('Select a vehicle before generating a day plan.');
      return;
    }

    const ambientTyped = parseOptionalNumber(ambientTemperature);
    const trackTyped = parseOptionalNumber(trackTemperature);
    if (Number.isNaN(ambientTyped) || Number.isNaN(trackTyped)) {
      setError('Temperatures must be numbers.');
      return;
    }
    const ambient = ambientTyped === undefined ? undefined : toStoredCelsius(ambientTyped, temperatureUnit);
    const track = trackTyped === undefined ? undefined : toStoredCelsius(trackTyped, temperatureUnit);

    setLoading(true);
    try {
      const res = await fetch('/api/ai/day-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          target_date: getLocalIsoDate(),
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          track_name: trackName.trim() || undefined,
          ambient_temperature_c: ambient,
          track_temperature_c: track,
          weather_condition: weatherCondition.trim() || undefined,
        }),
      });
      const parsed: unknown = await res.json();
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        typeof (parsed as { ok?: unknown }).ok !== 'boolean'
      ) {
        setError(`Unexpected response format (${res.status}).`);
        return;
      }
      const safeParsed = parsed as DayPlanResponse;
      if (!safeParsed.ok) {
        setError(safeParsed.error ?? `Request failed (${res.status}).`);
        return;
      }
      if (!isDayPlanSuccess(safeParsed)) {
        setError('Unexpected response shape on success.');
        return;
      }
      setResponse(safeParsed);
    } catch (err) {
      console.error('[day-plan-panel] request failed', err);
      setError('Unable to generate a day plan. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const advice = demoMode ? demoDayPlanAdvice : response?.advice ?? null;

  return (
    <section className="space-y-4 rounded-card bg-surface p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Morning Plan</h2>
        <p className="mt-1 text-sm text-ink-dim">
          Predict the day from your history, manual conditions, and any rider memory Race Engineer has learned.
        </p>
      </div>

      <form className="space-y-3" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-ink">Vehicle</span>
          <select
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            className="w-full rounded-row bg-surface-2 px-3 py-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          >
            <option value="">Select vehicle</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.nickname}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-ink">Track</span>
            <input
              value={trackName}
              onChange={(event) => setTrackName(event.target.value)}
              placeholder="Road America"
              className="w-full rounded-row bg-surface-2 px-3 py-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-ink">
              Ambient {temperatureUnitSuffix(temperatureUnit)}
            </span>
            <input
              value={ambientTemperature}
              onChange={(event) => setAmbientTemperature(event.target.value)}
              type="number"
              inputMode="decimal"
              step="any"
              placeholder={temperatureUnit === 'f' ? '75' : '24'}
              className="w-full rounded-row bg-surface-2 px-3 py-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-ink">
              Track {temperatureUnitSuffix(temperatureUnit)}
            </span>
            <input
              value={trackTemperature}
              onChange={(event) => setTrackTemperature(event.target.value)}
              type="number"
              inputMode="decimal"
              step="any"
              placeholder={temperatureUnit === 'f' ? '97' : '36'}
              className="w-full rounded-row bg-surface-2 px-3 py-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
            />
          </label>
        </div>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-ink">Weather trend</span>
          <input
            value={weatherCondition}
            onChange={(event) => setWeatherCondition(event.target.value)}
            placeholder="Cool morning, warming after lunch"
            className="w-full rounded-row bg-surface-2 px-3 py-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          />
        </label>

        {selectedVehicle ? (
          <p className="text-xs text-ink-faint">Planning for {selectedVehicle.nickname}.</p>
        ) : null}

        {/* In demo the button is a label, not an offer — a white pill would make
            the loudest thing on the page something you cannot press. */}
        <Button
          type="submit"
          fullWidth
          variant={demoMode ? 'secondary' : 'primary'}
          loading={loading}
          disabled={!vehicleId || demoMode}
        >
          {demoMode ? 'Sample plan shown' : loading ? 'Planning...' : 'Generate Morning Plan'}
        </Button>
      </form>

      {demoMode ? (
        <div className="rounded-row bg-surface-2 p-3 text-sm text-ink-dim">
          This is a static sample plan. Real Pro accounts can generate plans from their own history and current conditions.
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-row bg-surface-2 p-3 text-sm text-ink-dim">
          Building a plan from your vehicle history and today&apos;s inputs.
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-row border border-slower/30 bg-slower/12 p-3 text-sm text-slower">
          {error}
        </div>
      ) : null}

      {advice ? (
        <div className="space-y-3 border-t border-white/5 pt-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Plan</h3>
            <p className="mt-1 text-sm text-ink-dim">{advice.summary}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-ink-faint">
              Confidence: <span className="text-ink-dim">{advice.confidence}</span>
            </p>
          </div>
          {advice.recommended_changes.length > 0 ? (
            <ul className="space-y-2">
              {advice.recommended_changes.map((change, idx) => (
                <li key={`${change.component}-${idx}`} className="rounded-row bg-surface-2 p-3">
                  <p className="text-sm font-medium text-ink">{change.component}</p>
                  <p className="text-sm text-ink-dim">{change.direction} · {change.magnitude}</p>
                  <p className="mt-1 text-sm text-ink-dim">{change.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-row border border-dashed border-white/5 bg-surface-2 p-3 text-sm text-ink-faint">
              No specific setup change recommended yet. Establish a baseline and log feedback after the next session.
            </div>
          )}
          {advice.prediction ? (
            <div className="rounded-row bg-surface-2 p-3 text-sm text-ink-dim">
              <p>{advice.prediction.expected_effect}</p>
              <p className="mt-1 text-ink-dim">{advice.prediction.day_trend}</p>
            </div>
          ) : null}
          <div>
            <h3 className="text-sm font-semibold text-ink">Data used</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(advice.data_used).map(([key, used]) => (
                <span
                  key={key}
                  className={cn(
                    'rounded-plate px-2 py-1 text-xs font-medium',
                    used
                      ? 'bg-surface-3 text-ink'
                      : 'bg-surface-2 text-ink-faint',
                  )}
                >
                  {DATA_USED_LABELS[key] ?? key}
                </span>
              ))}
            </div>
          </div>
          {advice.citations.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">Citations</h3>
              <ul className="mt-2 space-y-2">
                {advice.citations.map((citation, idx) => (
                  <li key={`${citation.source}-${idx}`} className="rounded-row bg-surface-2 p-2">
                    <p className="font-mono text-xs text-ink-dim">{citation.source}</p>
                    <p className="mt-1 text-sm text-ink-dim">{citation.snippet}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
