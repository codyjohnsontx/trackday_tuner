import type { SessionFeedback } from '@/types';

export function VehicleOutcomeHistory({ outcomes }: { outcomes: SessionFeedback[] }) {
  if (outcomes.length === 0) return null;
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">What We&apos;ve Learned</h2>
      <ul className="mt-3 divide-y divide-zinc-800">{outcomes.map((outcome) => <li key={outcome.id} className="py-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium capitalize text-zinc-100">{outcome.outcome === 'unknown' ? 'Unsure' : outcome.outcome}</span><span className="text-xs text-zinc-500">Confidence {outcome.rider_confidence ?? '—'}/5</span></div>{outcome.symptoms.length ? <p className="mt-1 text-xs text-zinc-400">{outcome.symptoms.join(' · ')}</p> : null}{outcome.notes ? <p className="mt-1 text-sm text-zinc-300">{outcome.notes}</p> : null}</li>)}</ul>
    </section>
  );
}
