'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import type { AdviceResponse } from '@/lib/rag/schema';
import type { Vehicle } from '@/types';
import { cn } from '@/lib/utils';

interface DayPlanPanelProps {
  vehicles: Vehicle[];
  tier: 'free' | 'pro';
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
  telemetry: 'Telemetry',
};

export function DayPlanPanel({ vehicles, tier }: DayPlanPanelProps) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [trackName, setTrackName] = useState('');
  const [ambientTemperatureC, setAmbientTemperatureC] = useState('');
  const [trackTemperatureC, setTrackTemperatureC] = useState('');
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

  if (tier !== 'pro') {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Morning Plan</h2>
        <p className="mt-2 text-sm text-zinc-300">
          Pro unlocks forecast-aware Race Engineer planning from your past sessions.
        </p>
        <div className="mt-4">
          <UpgradeToProButton fullWidth />
        </div>
      </section>
    );
  }

  if (vehicles.length === 0) return null;

  function parseOptionalNumber(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setResponse(null);

    const ambient = parseOptionalNumber(ambientTemperatureC);
    const track = parseOptionalNumber(trackTemperatureC);
    if (Number.isNaN(ambient) || Number.isNaN(track)) {
      setError('Temperatures must be numbers.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/ai/day-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          target_date: new Date().toISOString().slice(0, 10),
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
      setResponse(safeParsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate a day plan.');
    } finally {
      setLoading(false);
    }
  }

  const advice = response?.advice ?? null;

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Morning Plan</h2>
        <p className="mt-1 text-sm text-zinc-300">
          Predict the day from your history, manual conditions, and any rider memory Race Engineer has learned.
        </p>
      </div>

      <form className="space-y-3" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-200">Vehicle</span>
          <select
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          >
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.nickname}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Track</span>
            <input
              value={trackName}
              onChange={(event) => setTrackName(event.target.value)}
              placeholder="Road America"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Ambient C</span>
            <input
              value={ambientTemperatureC}
              onChange={(event) => setAmbientTemperatureC(event.target.value)}
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="24"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Track C</span>
            <input
              value={trackTemperatureC}
              onChange={(event) => setTrackTemperatureC(event.target.value)}
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="36"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
            />
          </label>
        </div>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-200">Weather trend</span>
          <input
            value={weatherCondition}
            onChange={(event) => setWeatherCondition(event.target.value)}
            placeholder="Cool morning, warming after lunch"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          />
        </label>

        {selectedVehicle ? (
          <p className="text-xs text-zinc-500">Planning for {selectedVehicle.nickname}.</p>
        ) : null}

        <Button type="submit" fullWidth loading={loading}>
          {loading ? 'Planning...' : 'Generate Morning Plan'}
        </Button>
      </form>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {advice ? (
        <div className="space-y-3 border-t border-zinc-800 pt-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Plan</h3>
            <p className="mt-1 text-sm text-zinc-300">{advice.summary}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
              Confidence: <span className="text-zinc-300">{advice.confidence}</span>
            </p>
          </div>
          {advice.recommended_changes.length > 0 ? (
            <ul className="space-y-2">
              {advice.recommended_changes.map((change, idx) => (
                <li key={`${change.component}-${idx}`} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                  <p className="text-sm font-medium text-zinc-100">{change.component}</p>
                  <p className="text-sm text-zinc-300">{change.direction} · {change.magnitude}</p>
                  <p className="mt-1 text-sm text-zinc-500">{change.reason}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {advice.prediction ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">
              <p>{advice.prediction.expected_effect}</p>
              <p className="mt-1 text-zinc-500">{advice.prediction.day_trend}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {Object.entries(advice.data_used).map(([key, used]) => (
              <span
                key={key}
                className={cn(
                  'rounded-lg border px-2 py-1 text-xs font-medium',
                  used
                    ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-500',
                )}
              >
                {DATA_USED_LABELS[key] ?? key}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
