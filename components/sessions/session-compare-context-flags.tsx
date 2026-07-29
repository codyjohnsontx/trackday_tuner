import { cn } from '@/lib/utils';
import type { ContextFlag } from '@/lib/session-compare';

interface SessionCompareContextFlagsProps {
  flags: ContextFlag[];
}

const severityClass: Record<ContextFlag['severity'], string> = {
  info: 'bg-surface-2 text-ink-dim',
  warning: 'border-signal/30 bg-signal/12 text-signal',
  critical: 'border-slower/30 bg-slower/12 text-slower',
};

export function SessionCompareContextFlags({ flags }: SessionCompareContextFlagsProps) {
  return (
    <section className="rounded-card bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Context flags</h2>
      {flags.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {flags.map((flag) => (
            <li key={flag.key} className={cn('rounded-row border p-3', severityClass[flag.severity])}>
              <p className="text-sm font-semibold">{flag.label}</p>
              <p className="mt-1 text-xs opacity-80">{flag.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-dim">No major context warnings for this pair.</p>
      )}
    </section>
  );
}
