'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import type { AdviceResponse } from '@/lib/rag/schema';
import { cn } from '@/lib/utils';

const MIN_TEMPERATURE_C = -40;
const MAX_TEMPERATURE_C = 70;

const SYMPTOM_OPTIONS = [
  { id: 'understeer_entry', label: 'Understeer on entry' },
  { id: 'understeer_mid', label: 'Understeer mid-corner' },
  { id: 'oversteer_entry', label: 'Oversteer on entry' },
  { id: 'oversteer_exit', label: 'Oversteer on exit' },
  { id: 'front_chatter', label: 'Front chatter' },
  { id: 'rear_wallow', label: 'Rear wallow' },
  { id: 'packing_down', label: 'Packing down' },
  { id: 'brake_dive', label: 'Brake dive' },
  { id: 'low_grip_cold', label: 'Low grip (cold)' },
  { id: 'overheating_tire', label: 'Overheating tire' },
];

const INTENT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'stability_over_entry', label: 'Stability on entry' },
  { id: 'sharper_turn_in', label: 'Sharper turn-in' },
  { id: 'more_exit_grip', label: 'More exit grip' },
  { id: 'reduce_tire_wear', label: 'Reduce tire wear' },
  { id: 'better_feel', label: 'Better feel' },
];

interface TuningAdvicePanelProps {
  sessionId: string;
  vehicleId: string;
  tier: 'free' | 'pro';
}

interface ApiErrorBody {
  ok: false;
  error: string;
  request_id?: string;
}

interface ApiSuccessBody {
  ok: true;
  request_id: string;
  recommendation_id: string | null;
  advice: AdviceResponse;
  retrieved: Array<{ source: string; heading: string; score: number }>;
}

type ApiResponseBody = ApiErrorBody | ApiSuccessBody;

function SafetyBanner() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
      Informational only. You are responsible for vehicle safety and on-track conduct. Make one change at a time.
    </div>
  );
}

function ProUpgradeCard() {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Race Engineer</h2>
      <p className="mt-2 text-sm text-zinc-200">
        Your personal race engineer. Ask about this session and get a small, explainable setup suggestion with citations to a trusted knowledge base.
      </p>
      <p className="mt-1 text-sm text-zinc-400">Available on Pro.</p>
      <div className="mt-4">
        <UpgradeToProButton fullWidth />
      </div>
    </section>
  );
}

export function TuningAdvicePanel({ sessionId, vehicleId, tier }: TuningAdvicePanelProps) {
  const [question, setQuestion] = useState('');
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [intent, setIntent] = useState<string>('');
  const [temperature, setTemperature] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackOutcome, setFeedbackOutcome] = useState<'better' | 'same' | 'worse' | 'unknown'>('better');
  const [feedbackConfidence, setFeedbackConfidence] = useState('3');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [response, setResponse] = useState<ApiSuccessBody | null>(null);

  if (tier !== 'pro') {
    return <ProUpgradeCard />;
  }

  function toggleSymptom(id: string) {
    setSymptoms((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setFeedbackMessage('');
    setFeedbackError('');
    setResponse(null);

    const trimmed = question.trim();
    if (trimmed.length < 10) {
      setError('Please describe the symptom in at least 10 characters.');
      return;
    }

    const body: Record<string, unknown> = {
      session_id: sessionId,
      vehicle_id: vehicleId,
      question: trimmed,
    };
    if (symptoms.length > 0) body.symptoms = symptoms;
    if (intent) body.change_intent = intent;
    if (temperature.trim().length > 0) {
      const parsed = Number(temperature);
      if (!Number.isFinite(parsed)) {
        setError('Temperature must be a number in Celsius.');
        return;
      }
      if (parsed < MIN_TEMPERATURE_C || parsed > MAX_TEMPERATURE_C) {
        setError(
          `Temperature must be between ${MIN_TEMPERATURE_C}\u00b0C and ${MAX_TEMPERATURE_C}\u00b0C.`,
        );
        return;
      }
      body.temperature_c = parsed;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/ai/tuning-advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let parsed: ApiResponseBody;
      try {
        parsed = JSON.parse(raw) as ApiResponseBody;
      } catch {
        parsed = { ok: false, error: `Server returned non-JSON response (${res.status}).` };
      }
      if (!parsed.ok) {
        setError(parsed.error ?? `Request failed (${res.status}).`);
        return;
      }
      setResponse(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Race Engineer.');
    } finally {
      setLoading(false);
    }
  }

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!response?.recommendation_id) return;

    setFeedbackLoading(true);
    setFeedbackError('');
    setFeedbackMessage('');
    try {
      const parsedConfidence = Number(feedbackConfidence);
      const res = await fetch('/api/ai/recommendation-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          vehicle_id: vehicleId,
          recommendation_id: response.recommendation_id,
          outcome: feedbackOutcome,
          rider_confidence: Number.isInteger(parsedConfidence) ? parsedConfidence : undefined,
          symptoms,
          notes: feedbackNotes.trim() || undefined,
        }),
      });
      const parsed = await res.json() as { ok: boolean; error?: string };
      if (!parsed.ok) {
        setFeedbackError(parsed.error ?? `Feedback failed (${res.status}).`);
        return;
      }
      setFeedbackMessage('Feedback saved. Race Engineer will use it as rider memory next time.');
      setFeedbackNotes('');
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Unable to save feedback.');
    } finally {
      setFeedbackLoading(false);
    }
  }

  const advice = response?.advice ?? null;
  const refusal = advice?.refusal?.trim();
  const hasRecommendations = Boolean(advice && advice.recommended_changes.length > 0);

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Race Engineer</h2>
        <p className="mt-1 text-sm text-zinc-300">
          Your personal race engineer. Ask one small, specific question about this session and Race Engineer will return a single primary recommendation, with an optional secondary check when it matters.
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label htmlFor="race_engineer_question" className="block space-y-2">
          <span className="text-sm font-medium text-zinc-200">What did you feel?</span>
          <textarea
            id="race_engineer_question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            minLength={10}
            maxLength={1000}
            placeholder="Front pushed mid-corner after raising pressure 1 psi."
            className="flex w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          />
          <span className="text-xs text-zinc-500">{question.length}/1000</span>
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-200">Symptoms (optional)</legend>
          <div className="flex flex-wrap gap-2">
            {SYMPTOM_OPTIONS.map((opt) => {
              const active = symptoms.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleSymptom(opt.id)}
                  className={cn(
                    'min-h-11 rounded-xl border px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
                    active
                      ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-200'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label htmlFor="race_engineer_intent" className="block space-y-2">
          <span className="text-sm font-medium text-zinc-200">What are you trying to improve?</span>
          <select
            id="race_engineer_intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            className="flex w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <option value="">No specific goal</option>
            {INTENT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="race_engineer_temperature" className="block space-y-2">
          <span className="text-sm font-medium text-zinc-200">Ambient temperature (C, optional)</span>
          <input
            id="race_engineer_temperature"
            type="number"
            inputMode="decimal"
            step="any"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            placeholder="24"
            min={-40}
            max={70}
            className="flex w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          />
        </label>

        <Button type="submit" variant="primary" fullWidth loading={loading} disabled={loading}>
          {loading ? 'Thinking...' : 'Ask Race Engineer'}
        </Button>
      </form>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {advice ? (
        <div className="space-y-4">
          <SafetyBanner />

          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Summary</h3>
            <p className="mt-1 text-sm text-zinc-200 whitespace-pre-wrap">{advice.summary}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
              Confidence: <span className="text-zinc-300">{advice.confidence}</span>
            </p>
          </div>

          {refusal ? (
            <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Refusal</p>
              <p className="mt-1">{refusal}</p>
            </div>
          ) : null}

          {hasRecommendations ? (
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Recommended change</h3>
              <ul className="mt-2 space-y-3">
                {advice.recommended_changes.map((change, idx) => (
                  <li
                    key={`${change.component}-${idx}`}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"
                  >
                    <p className="text-sm font-medium text-zinc-100">
                      {change.component}
                    </p>
                    <p className="text-sm text-zinc-300">
                      {change.direction} · {change.magnitude}
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">{change.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {advice.tradeoffs.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Tradeoffs</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
                {advice.tradeoffs.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {advice.prediction ? (
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Prediction</h3>
              <div className="mt-2 space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">
                <p>{advice.prediction.expected_effect}</p>
                <p className="text-zinc-400">{advice.prediction.day_trend}</p>
                {advice.prediction.watch_items.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5">
                    {advice.prediction.watch_items.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {advice.personal_evidence.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Personal evidence</h3>
              <ul className="mt-2 space-y-2 text-sm text-zinc-300">
                {advice.personal_evidence.map((evidence, idx) => (
                  <li key={idx} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <p className="font-medium text-zinc-100">{evidence.label}</p>
                    <p className="mt-1 text-zinc-400">{evidence.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Data used</h3>
            <div className="mt-2 flex flex-wrap gap-2">
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
                  {key}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Safety notes</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
              {advice.safety_notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>

          {advice.citations.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Citations</h3>
              <ul className="mt-2 space-y-2 text-sm text-zinc-300">
                {advice.citations.map((c, i) => (
                  <li key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
                    <p className="text-xs font-mono text-zinc-400">{c.source}</p>
                    <p className="mt-1 text-sm text-zinc-200">{c.snippet}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {response?.request_id ? (
            <p className="text-xs text-zinc-500">Request id: {response.request_id}</p>
          ) : null}

          {response?.recommendation_id && hasRecommendations ? (
            <form className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3" onSubmit={submitFeedback}>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Teach Race Engineer</h3>
                <p className="mt-1 text-xs text-zinc-500">After you try it, save how the next session felt.</p>
              </div>
              <div className="grid grid-cols-4 gap-2 rounded-xl bg-zinc-900 p-1">
                {[
                  ['better', 'Better'],
                  ['same', 'Same'],
                  ['worse', 'Worse'],
                  ['unknown', 'Unsure'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFeedbackOutcome(value as typeof feedbackOutcome)}
                    className={cn(
                      'min-h-11 rounded-lg px-2 text-xs font-semibold transition',
                      feedbackOutcome === value
                        ? 'bg-cyan-400 text-zinc-950'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-zinc-300">Rider confidence</span>
                <select
                  value={feedbackConfidence}
                  onChange={(event) => setFeedbackConfidence(event.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-zinc-300">Feedback notes</span>
                <textarea
                  value={feedbackNotes}
                  onChange={(event) => setFeedbackNotes(event.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Felt better on entry but rear got greasy after four laps."
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
                />
              </label>
              {feedbackError ? <p className="text-sm text-rose-300">{feedbackError}</p> : null}
              {feedbackMessage ? <p className="text-sm text-emerald-300">{feedbackMessage}</p> : null}
              <Button type="submit" variant="secondary" fullWidth loading={feedbackLoading}>
                Save Feedback
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
