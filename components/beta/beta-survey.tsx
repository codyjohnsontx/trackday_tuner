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

  if (complete) return <section className="border-l-2 border-cyan-400 pl-4"><p className="font-semibold text-zinc-100">Feedback received.</p><p className="mt-1 text-sm text-zinc-400">This is exactly what the founding beta is for.</p></section>;
  const selectClass = 'min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80';
  return (
    <section className="space-y-4 rounded-2xl border border-cyan-400/20 bg-zinc-900/70 p-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Founding rider check-in</p><h2 className="mt-1 text-lg font-semibold">Two track days in—does this earn a place in your routine?</h2></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1"><span className="text-xs text-zinc-400">Comparisons useful?</span><select value={comparison} onChange={(event) => setComparison(event.target.value)} className={selectClass}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
        <label className="space-y-1"><span className="text-xs text-zinc-400">AI guidance useful?</span><select value={ai} onChange={(event) => setAi(event.target.value)} className={selectClass}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
      </div>
      <label className="block space-y-1"><span className="text-xs text-zinc-400">If Trackday Tuner disappeared, how disappointed?</span><select value={disappointment} onChange={(event) => setDisappointment(event.target.value)} className={selectClass}><option value="very">Very disappointed</option><option value="somewhat">Somewhat disappointed</option><option value="not">Not disappointed</option></select></label>
      <label className="block space-y-1"><span className="text-xs text-zinc-400">What is the biggest problem we should solve next?</span><textarea value={problem} onChange={(event) => setProblem(event.target.value)} maxLength={1000} rows={3} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm" /></label>
      <label className="flex items-start gap-3 text-xs text-zinc-400"><input type="checkbox" checked={interview} onChange={(event) => setInterview(event.target.checked)} className="mt-0.5 h-5 w-5 accent-cyan-400" /><span>I&apos;m open to a 20-minute rider interview.</span></label>
      {message ? <p className="text-sm text-rose-300">{message}</p> : null}
      <Button type="button" fullWidth loading={loading} onClick={submit}>Send Founding Feedback</Button>
    </section>
  );
}
