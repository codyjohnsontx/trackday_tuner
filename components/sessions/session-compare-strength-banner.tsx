import { cn } from '@/lib/utils';
import type { ComparisonStrength } from '@/lib/session-compare';

interface SessionCompareStrengthBannerProps {
  strength: ComparisonStrength;
  summary: string;
}

// Three levels need three treatments — `useful` and `weak` were previously
// identical, so the scale read as two. Only `weak` earns the accent: it is the
// one telling you to distrust what you are about to read.
const strengthCopy: Record<ComparisonStrength, { label: string; detail: string; className: string }> = {
  strong: {
    label: 'Strong comparison',
    detail: 'Close context gives this pair a cleaner comparison signal.',
    className: 'bg-faster/12 text-faster',
  },
  useful: {
    label: 'Useful comparison',
    detail: 'The signal is usable, with context differences to keep in view.',
    className: 'bg-surface-2 text-ink-dim',
  },
  weak: {
    label: 'Weak comparison',
    detail: 'Major context differences limit what this pair can tell you.',
    className: 'bg-signal/12 text-signal',
  },
};

export function SessionCompareStrengthBanner({ strength, summary }: SessionCompareStrengthBannerProps) {
  const copy = strengthCopy[strength];

  return (
    <section className={cn('rounded-card p-4', copy.className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{copy.label}</h2>
          <p className="mt-1 text-xs opacity-80">{copy.detail}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-ink">{summary}</p>
    </section>
  );
}
