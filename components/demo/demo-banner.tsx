import Link from 'next/link';

export function DemoBanner() {
  return (
    <section className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-cyan-100">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Demo Mode</p>
          <p className="mt-1 text-sm text-cyan-100/80">
            You are viewing sample data. Create a real account to save vehicles, sessions, tracks, exports, and AI recommendations.
          </p>
        </div>
        <Link
          href="/demo/exit"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/40 px-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/10 focus-visible:ring-2 focus-visible:ring-cyan-400/80"
        >
          Exit Demo
        </Link>
      </div>
    </section>
  );
}
