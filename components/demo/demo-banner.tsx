import { FlaskConical } from 'lucide-react';
import { Eyebrow } from '@/components/ui/surface';

export function DemoBanner() {
  return (
    <section className="rounded-card bg-surface p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Eyebrow icon={FlaskConical} className="text-signal">
            Demo mode
          </Eyebrow>
          <p className="mt-2 text-sm text-ink-dim">
            You are viewing sample data. Create a real account to save vehicles, sessions, tracks,
            exports, and AI recommendations.
          </p>
        </div>
        <a
          href="/demo/exit"
          className="inline-flex min-h-11 shrink-0 select-none items-center justify-center self-start rounded-full bg-surface-3 px-5 text-sm font-semibold text-ink transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
        >
          Exit Demo
        </a>
      </div>
    </section>
  );
}
