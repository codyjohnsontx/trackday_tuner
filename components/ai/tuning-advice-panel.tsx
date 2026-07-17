'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { classifyRaceEngineerQuestion } from '@/lib/rag/domain-guard';
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

const DATA_USED_LABELS: Record<string, string> = {
  manual: 'Manual Input',
  weather: 'Weather Data',
  history: 'Session History',
  feedback: 'Past Feedback',
  lap_data: 'Lap Data',
  telemetry: 'Telemetry',
};

interface TuningAdvicePanelProps {
  sessionId: string;
  vehicleId: string;
  tier: 'free' | 'pro';
  demoMode?: boolean;
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

function RefusalCard({ message }: { message: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/70 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Couldn&apos;t answer that request</p>
        <p className="mt-1 text-sm text-zinc-200">{message}</p>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-300">
        <p className="font-medium text-zinc-100">Race Engineer can help with questions like:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Front pushed on entry after I raised pressure 1 psi. What should I try next?</li>
          <li>Rear overheated after four laps. What is the first thing I should check?</li>
          <li>I changed rebound and the bike started wallowing. Should I undo that or try another small step?</li>
        </ul>
      </div>
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

const demoTuningAdvice: AdviceResponse = {
  summary:
    'Return front pressure toward the baseline and undo the added rebound before making another geometry change. The worse session changed two front-end variables at once, and the better session recovered feel by moving back toward baseline.',
  recommended_changes: [
    {
      component: 'Front setup',
      direction: 'Return toward baseline',
      magnitude: '33 psi hot front and 10-11 clicks rebound out',
      reason: 'The demo history shows front push after raising pressure and adding rebound, then better turn-in after lowering pressure and softening compression.',
    },
  ],
  tradeoffs: [
    'Lower front pressure can improve feel, but going too far can reduce support and overheat the tire.',
    'Undo one change at a time so the next session tells you which adjustment mattered.',
  ],
  confidence: 'medium',
  safety_notes: ['Make one change at a time.', 'Confirm tire pressure targets with your tire vendor or trackside support.'],
  citations: [
    {
      source: 'Demo history',
      snippet: 'Session 2 pushed mid-corner; Session 3 improved after moving front setup back toward baseline.',
    },
  ],
  prediction: {
    expected_effect: 'The bike should finish corners more easily and need less bar pressure mid-corner.',
    day_trend: 'If track temperature keeps climbing, watch rear grip separately instead of masking it with front-end changes.',
    watch_items: ['Front push mid-corner', 'Rear drive after several hot laps'],
  },
  personal_evidence: [
    {
      label: 'Session 2 to Session 3',
      detail: 'Front pressure and damping changes explain the largest feel difference in the sample data.',
      source_session_id: 'demo-session-3',
    },
  ],
  data_used: {
    manual: true,
    weather: false,
    history: true,
    feedback: false,
    lap_data: false,
    telemetry: false,
  },
  refusal: null,
};

export function TuningAdvicePanel({ sessionId, vehicleId, tier, demoMode = false }: TuningAdvicePanelProps) {
  const [question, setQuestion] = useState('');
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [intent, setIntent] = useState<string>('');
  const [temperature, setTemperature] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [response, setResponse] = useState<ApiSuccessBody | null>(null);

  const questionAssessment = useMemo(
    () =>
      classifyRaceEngineerQuestion({
        question,
        symptoms,
        changeIntent: intent,
      }),
    [question, symptoms, intent],
  );
  const showQuestionWarning =
    question.trim().length >= 10 && questionAssessment.decision === 'refuse';

  if (demoMode) {
    const advice = demoTuningAdvice;
    return (
      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Race Engineer</h2>
          <p className="mt-1 text-sm text-zinc-300">
            Static sample advice from the demo history. Real Pro accounts can ask Race Engineer about their own sessions.
          </p>
        </div>
        <SafetyBanner />
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Summary</h3>
          <p className="mt-1 text-sm text-zinc-200 whitespace-pre-wrap">{advice.summary}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
            Confidence: <span className="text-zinc-300">{advice.confidence}</span>
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Recommended change</h3>
          <ul className="mt-2 space-y-3">
            {advice.recommended_changes.map((change, idx) => (
              <li key={`${change.component}-${idx}`} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <p className="text-sm font-medium text-zinc-100">{change.component}</p>
                <p className="text-sm text-zinc-300">{change.direction} · {change.magnitude}</p>
                <p className="mt-1 text-sm text-zinc-400">{change.reason}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Tradeoffs</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
            {advice.tradeoffs.map((tradeoff) => (
              <li key={tradeoff}>{tradeoff}</li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  if (tier !== 'pro') {
    return <ProUpgradeCard />;
  }

  function clearActiveAdviceState() {
    setError('');
    setResponse(null);
  }

  function setQuestionValue(value: string) {
    clearActiveAdviceState();
    setQuestion(value);
  }

  function toggleSymptom(id: string) {
    clearActiveAdviceState();
    setSymptoms((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );
  }

  function setIntentValue(value: string) {
    clearActiveAdviceState();
    setIntent(value);
  }

  function setTemperatureValue(value: string) {
    clearActiveAdviceState();
    setTemperature(value);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
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

  const advice = response?.advice ?? null;
  const refusal = advice?.refusal?.trim();
  const hasRecommendations = Boolean(advice && advice.recommended_changes.length > 0);
  const isRefusal = Boolean(refusal);

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
            onChange={(e) => setQuestionValue(e.target.value)}
            rows={3}
            minLength={10}
            maxLength={1000}
            placeholder="Front pushed mid-corner after raising pressure 1 psi."
            className="flex w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          />
          <span className="text-xs text-zinc-500">
            Ask about setup, grip, balance, pressures, damping, or what changed on track.
          </span>
          <span className="text-xs text-zinc-500">{question.length}/1000</span>
        </label>

        {showQuestionWarning ? (
          <div
            role="status"
            className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-200"
          >
            Race Engineer only answers track setup questions. This looks unrelated, so it will return a refusal instead of a setup recommendation.
          </div>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-200">Symptoms (optional)</legend>
          <p className="text-xs text-zinc-500">
            Symptoms add context to a real track question, but they do not replace it.
          </p>
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
            onChange={(e) => setIntentValue(e.target.value)}
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
            onChange={(e) => setTemperatureValue(e.target.value)}
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

          {isRefusal ? <RefusalCard message={refusal!} /> : null}

          {!isRefusal ? (
            <>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Summary</h3>
                <p className="mt-1 text-sm text-zinc-200 whitespace-pre-wrap">{advice.summary}</p>
                <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
                  Confidence: <span className="text-zinc-300">{advice.confidence}</span>
                </p>
              </div>

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
                      {DATA_USED_LABELS[key] ?? key}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Safety notes</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
              {advice.safety_notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>

          {!isRefusal && advice.citations.length > 0 ? (
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
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-3">
              <p className="text-sm font-medium text-cyan-100">Test this in a later session.</p>
              <p className="mt-1 text-xs text-zinc-400">
                After the next session, record the outcome there so Race Engineer learns from the right comparison.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
