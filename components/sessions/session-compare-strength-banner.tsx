import { cn } from '@/lib/utils';
import type { ComparisonStrength } from '@/lib/session-compare';

interface SessionCompareStrengthBannerProps {
  strength: ComparisonStrength;
  summary: string;
}

const strengthCopy: Record<ComparisonStrength, { label: string; detail: string; className: string }> = {
  strong: {
    label: 'Strong comparison',
    detail: 'Close context gives this pair a cleaner comparison signal.',
    className: 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200',
  },
  useful: {
    label: 'Useful comparison',
    detail: 'The signal is usable, with context differences to keep in view.',
    className: 'border-cyan-800/70 bg-cyan-950/30 text-cyan-100',
  },
  weak: {
    label: 'Weak comparison',
    detail: 'Major context differences limit what this pair can tell you.',
    className: 'border-amber-800/70 bg-amber-950/30 text-amber-100',
  },
};

export function SessionCompareStrengthBanner({ strength, summary }: SessionCompareStrengthBannerProps) {
  const copy = strengthCopy[strength];

  return (
    <section className={cn('rounded-2xl border p-4', copy.className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{copy.label}</h2>
          <p className="mt-1 text-xs opacity-80">{copy.detail}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-100">{summary}</p>
    </section>
  );
}
