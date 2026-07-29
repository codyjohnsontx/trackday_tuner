import type { SessionFeedback } from '@/types';

export function VehicleOutcomeHistory({ outcomes }: { outcomes: SessionFeedback[] }) {
  if (outcomes.length === 0) return null;
  return (
    <section className="rounded-card bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">What We&apos;ve Learned</h2>
      <ul className="mt-3 divide-y divide-white/5">{outcomes.map((outcome) => <li key={outcome.id} className="py-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium capitalize text-ink">{outcome.outcome === 'unknown' ? 'Unsure' : outcome.outcome}</span><span className="text-xs text-ink-faint">Confidence {outcome.rider_confidence ?? '—'}/5</span></div>{outcome.symptoms.length ? <p className="mt-1 text-xs text-ink-dim">{outcome.symptoms.join(' · ')}</p> : null}{outcome.notes ? <p className="mt-1 text-sm text-ink-dim">{outcome.notes}</p> : null}</li>)}</ul>
    </section>
  );
}
