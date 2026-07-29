'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { trackProductEvent } from '@/lib/product-events.client';

export function BetaSurvey() {
  const [comparison, setComparison] = useState('4');
  const [ai, setAi] = useState('4');
  const [disappointment, setDisappointment] = useState('very');
  const [problem, setProblem] = useState('');
  const [interview, setInterview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [complete, setComplete] = useState(false);

  async function submit() {
    setLoading(true); setMessage('');
    try {
      const response = await fetch('/api/beta/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comparison_usefulness: Number(comparison), ai_guidance_usefulness: Number(ai), disappointment, biggest_problem: problem, interview_opt_in: interview }),
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) { setMessage(result.error ?? 'Unable to save feedback.'); return; }
      trackProductEvent('beta_survey_submitted', { properties: { comparison_usefulness: Number(comparison), ai_guidance_usefulness: Number(ai), disappointment } });
      setComplete(true);
    } catch { setMessage('Unable to reach the feedback service.'); } finally { setLoading(false); }
  }

  if (complete) return <section className="border-l-2 border-faster/40 pl-4"><p className="font-semibold text-ink">Feedback received.</p><p className="mt-1 text-sm text-ink-dim">This is exactly what the founding beta is for.</p></section>;
  const selectClass = 'min-h-11 w-full rounded-row bg-surface-3 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80';
  return (
    <section className="space-y-4 rounded-card bg-surface p-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Founding rider check-in</p><h2 className="mt-1 text-lg font-semibold">Two track days in—does this earn a place in your routine?</h2></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1"><span className="text-xs text-ink-dim">Comparisons useful?</span><select value={comparison} onChange={(event) => setComparison(event.target.value)} className={selectClass}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
        <label className="space-y-1"><span className="text-xs text-ink-dim">AI guidance useful?</span><select value={ai} onChange={(event) => setAi(event.target.value)} className={selectClass}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
      </div>
      <label className="block space-y-1"><span className="text-xs text-ink-dim">If Trackday Tuner disappeared, how disappointed?</span><select value={disappointment} onChange={(event) => setDisappointment(event.target.value)} className={selectClass}><option value="very">Very disappointed</option><option value="somewhat">Somewhat disappointed</option><option value="not">Not disappointed</option></select></label>
      <label className="block space-y-1"><span className="text-xs text-ink-dim">What is the biggest problem we should solve next?</span><textarea value={problem} onChange={(event) => setProblem(event.target.value)} maxLength={1000} rows={3} className="w-full rounded-row bg-surface-3 px-3 py-3 text-sm focus-visible:ring-2 focus-visible:ring-signal/80" /></label>
      <label className="flex items-start gap-3 text-xs text-ink-dim"><input type="checkbox" checked={interview} onChange={(event) => setInterview(event.target.checked)} className="mt-0.5 h-5 w-5 accent-signal focus-visible:ring-2 focus-visible:ring-signal/80" /><span>I&apos;m open to a 20-minute rider interview.</span></label>
      {message ? <p className="text-sm text-slower">{message}</p> : null}
      <Button type="button" fullWidth loading={loading} onClick={submit}>Send Founding Feedback</Button>
    </section>
  );
}
