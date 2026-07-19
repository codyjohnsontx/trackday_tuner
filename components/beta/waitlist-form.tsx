'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function WaitlistForm() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    setLoading(true); setMessage('');
    try {
      const response = await fetch('/api/beta/waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, consent: form.get('consent') === 'true' }),
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) { setMessage(result.error ?? 'Unable to join.'); return; }
      setSuccess(true);
    } catch { setMessage('Unable to reach the waitlist.'); } finally { setLoading(false); }
  }

  if (success) return <div className="border-l-2 border-cyan-400 pl-4"><p className="text-lg font-semibold text-zinc-100">You&apos;re on the list.</p><p className="mt-1 text-sm text-zinc-400">We&apos;ll prioritize riders with two upcoming track days and send approved invitations manually.</p></div>;

  const selectClass = 'min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80';
  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="hidden" aria-hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <Input name="email" label="Email" type="email" autoComplete="email" required placeholder="you@example.com" />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1"><span className="text-xs text-zinc-400">Vehicle</span><select name="vehicle_interest" defaultValue="motorcycle" className={selectClass}><option value="motorcycle">Motorcycle</option><option value="car">Car</option><option value="both">Both</option></select></label>
        <label className="space-y-1"><span className="text-xs text-zinc-400">Activity</span><select name="activity_type" defaultValue="track_day" className={selectClass}><option value="track_day">Track days</option><option value="hpde">HPDE</option><option value="club_racing">Club racing</option></select></label>
        <label className="space-y-1"><span className="text-xs text-zinc-400">Experience</span><select name="experience_level" defaultValue="intermediate" className={selectClass}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
        <label className="space-y-1"><span className="text-xs text-zinc-400">Current logging</span><select name="current_tracking_method" defaultValue="phone_notes" className={selectClass}><option value="paper">Paper</option><option value="phone_notes">Phone notes</option><option value="spreadsheet">Spreadsheet</option><option value="other_app">Another app</option><option value="none">Nothing yet</option></select></label>
      </div>
      <label className="space-y-1"><span className="text-xs text-zinc-400">Track days in the next 90 days</span><select name="upcoming_track_days" defaultValue="two_or_more" className={selectClass}><option value="zero">None scheduled</option><option value="one">One</option><option value="two_or_more">Two or more</option></select></label>
      <label className="space-y-1"><span className="text-xs text-zinc-400">What do you want to learn? (optional)</span><textarea name="optional_context" maxLength={500} rows={3} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm focus-visible:ring-2 focus-visible:ring-cyan-400/80" /></label>
      <label className="flex items-start gap-3 text-xs text-zinc-400"><input type="checkbox" name="consent" value="true" required className="mt-0.5 h-5 w-5 accent-cyan-400" /><span>I agree to beta communications and the <Link href="/privacy" className="text-cyan-300 underline">privacy notice</Link>.</span></label>
      {message ? <p className="text-sm text-rose-300">{message}</p> : null}
      <Button type="submit" fullWidth loading={loading}>Join the Founding Beta</Button>
    </form>
  );
}
