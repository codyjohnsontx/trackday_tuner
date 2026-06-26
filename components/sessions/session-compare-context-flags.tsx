import { cn } from '@/lib/utils';
import type { ContextFlag } from '@/lib/session-compare';

interface SessionCompareContextFlagsProps {
  flags: ContextFlag[];
}

const severityClass: Record<ContextFlag['severity'], string> = {
  info: 'border-zinc-800 bg-zinc-950 text-zinc-300',
  warning: 'border-amber-800/70 bg-amber-950/20 text-amber-100',
  critical: 'border-rose-800/70 bg-rose-950/20 text-rose-100',
};

export function SessionCompareContextFlags({ flags }: SessionCompareContextFlagsProps) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Context flags</h2>
      {flags.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {flags.map((flag) => (
            <li key={flag.key} className={cn('rounded-xl border p-3', severityClass[flag.severity])}>
              <p className="text-sm font-semibold">{flag.label}</p>
              <p className="mt-1 text-xs opacity-80">{flag.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No major context warnings for this pair.</p>
      )}
    </section>
  );
}
