'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChoiceRow } from '@/components/ui/choice-row';
import { formatComponentLabel, formatDirectionLabel } from '@/lib/rag/component-vocabulary';
import { FEEDBACK_OUTCOME_OPTIONS } from '@/lib/session-answers';
import { trackProductEvent } from '@/lib/product-events.client';
import { cn } from '@/lib/utils';
import type { AiRecommendation, FeedbackOutcome, Session, SessionFeedback } from '@/types';

const SYMPTOMS = ['Front push', 'Rear slide', 'Brake dive', 'Chatter', 'Wallow', 'Tire fade'];

export function SessionOutcomePanel({
  session,
  references,
  recommendations,
  existing,
  disabled,
}: {
  session: Session;
  references: Session[];
  recommendations: AiRecommendation[];
  existing: SessionFeedback | null;
  disabled: boolean;
}) {
  const [referenceId, setReferenceId] = useState(existing?.reference_session_id ?? references[0]?.id ?? '');
  const [recommendationId, setRecommendationId] = useState(existing?.recommendation_id ?? '');
  // No verdict until the rider gives one. `?? 'better'` used to file the most
  // flattering answer straight into the learning record - see
  // lib/session-answers.ts.
  const [outcome, setOutcome] = useState<FeedbackOutcome | null>(existing?.outcome ?? null);
  const [confidence, setConfidence] = useState(String(existing?.rider_confidence ?? 3));
  const [helpfulness, setHelpfulness] = useState(String(existing?.recommendation_helpfulness ?? 4));
  const [symptoms, setSymptoms] = useState<string[]>(existing?.symptoms ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [editing, setEditing] = useState(!existing);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!existing && references.length > 0) {
      trackProductEvent('session_outcome_prompt_viewed', { session_id: session.id, vehicle_id: session.vehicle_id });
    }
  }, [existing, references.length, session.id, session.vehicle_id]);

  if (references.length === 0) return null;

  async function save() {
    if (!outcome) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`/api/sessions/${session.id}/outcome`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference_session_id: referenceId,
          recommendation_id: recommendationId || null,
          outcome,
          rider_confidence: Number(confidence),
          symptoms,
          notes: notes.trim() || null,
          recommendation_helpfulness: recommendationId ? Number(helpfulness) : null,
        }),
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) { setMessage(result.error ?? 'Unable to save outcome.'); return; }
      trackProductEvent('session_outcome_saved', { session_id: session.id, vehicle_id: session.vehicle_id, properties: { outcome } });
      if (recommendationId) trackProductEvent('recommendation_linked_to_outcome', { session_id: session.id, vehicle_id: session.vehicle_id });
      setMessage('Outcome saved. Race Engineer can use it next time.');
      setEditing(false);
    } catch { setMessage('Unable to reach the outcome service.'); } finally { setLoading(false); }
  }

  return (
    <section className="space-y-4 rounded-card bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Session Outcome</h2><p className="mt-1 text-sm text-ink-dim">Compare the result, then teach Race Engineer what actually happened.</p></div>
        {!editing && !disabled ? <Button type="button" variant="secondary" onClick={() => setEditing(true)}>Edit</Button> : null}
      </div>

      {!editing ? (
        <div><p className="text-lg font-semibold capitalize text-ink">{outcome === null ? 'Not recorded' : outcome === 'unknown' ? 'Unsure' : outcome}</p>{message ? <p className="mt-1 text-sm text-faster">{message}</p> : null}</div>
      ) : (
        <>
          <label className="block space-y-1"><span className="text-xs text-ink-dim">Compared with</span><select value={referenceId} onChange={(event) => setReferenceId(event.target.value)} className="min-h-11 w-full rounded-row bg-surface-3 px-3 text-sm focus-visible:ring-2 focus-visible:ring-signal/80"><option value="" disabled>Select an earlier session</option>{references.map((reference) => <option key={reference.id} value={reference.id}>{reference.track_name ?? 'Track'} · {reference.date}{reference.session_number ? ` · S${reference.session_number}` : ''}</option>)}</select></label>
          <ChoiceRow label="Session outcome" options={FEEDBACK_OUTCOME_OPTIONS} value={outcome} onChange={setOutcome} />
          <label className="block space-y-1"><span className="text-xs text-ink-dim">AI recommendation tested (optional)</span><select value={recommendationId} onChange={(event) => setRecommendationId(event.target.value)} className="min-h-11 w-full rounded-row bg-surface-3 px-3 text-sm focus-visible:ring-2 focus-visible:ring-signal/80"><option value="">None — manual or coach-led change</option>{recommendations.map((recommendation) => <option key={recommendation.id} value={recommendation.id}>{recommendation.component ? formatComponentLabel(recommendation.component) : 'Setup'} · {recommendation.direction ? formatDirectionLabel(recommendation.direction) : recommendation.summary}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className="text-xs text-ink-dim">Rider confidence</span><select value={confidence} onChange={(event) => setConfidence(event.target.value)} className="min-h-11 w-full rounded-row bg-surface-3 px-3 text-sm focus-visible:ring-2 focus-visible:ring-signal/80">{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label>{recommendationId ? <label className="space-y-1"><span className="text-xs text-ink-dim">AI usefulness</span><select value={helpfulness} onChange={(event) => setHelpfulness(event.target.value)} className="min-h-11 w-full rounded-row bg-surface-3 px-3 text-sm focus-visible:ring-2 focus-visible:ring-signal/80">{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label> : null}</div>
          <div><p className="mb-2 text-xs text-ink-dim">Symptoms observed</p><div className="flex flex-wrap gap-2">{SYMPTOMS.map((symptom) => <button key={symptom} type="button" aria-pressed={symptoms.includes(symptom)} onClick={() => setSymptoms((current) => current.includes(symptom) ? current.filter((item) => item !== symptom) : [...current, symptom])} className={cn('min-h-11 rounded-row border px-3 text-xs focus-visible:ring-2 focus-visible:ring-signal/80', symptoms.includes(symptom) ? 'border-signal/30 bg-signal/10 text-signal' : 'border-white/10 text-ink-dim')}>{symptom}</button>)}</div></div>
          <label className="block space-y-1"><span className="text-xs text-ink-dim">Outcome notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={3} className="w-full rounded-row bg-surface-3 px-3 py-3 text-sm focus-visible:ring-2 focus-visible:ring-signal/80" placeholder="What improved, what did not, and where did you feel it?" /></label>
          {message ? <p className="text-sm text-slower">{message}</p> : null}
          <Button type="button" fullWidth loading={loading} disabled={disabled || !referenceId || !outcome} onClick={save}>Save Outcome</Button>
          {!outcome ? <p className="text-sm text-ink-faint">Pick how the session went before saving. Race Engineer learns from this, so it is not filled in for you.</p> : null}
        </>
      )}
    </section>
  );
}
