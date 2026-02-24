import Link from 'next/link';
import type { Route } from 'next';

function ToolCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: Route;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-600"
    >
      <p className="text-base font-semibold text-zinc-100">{title}</p>
      <p className="mt-1 text-sm text-zinc-400">{description}</p>
    </Link>
  );
}

export default function ToolsPage() {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h1 className="text-2xl font-bold text-zinc-100">Tools</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Dedicated calculators and utilities for trackside setup work.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Calculators</h2>
        <ToolCard
          title="Sag Calculator"
          description="Calculate free/static and rider/race sag in mm and % of travel."
          href="/sag"
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Utilities</h2>
        <ToolCard
          title="Tracks"
          description="Manage seeded and custom tracks used in session logging."
          href="/tracks"
        />
      </section>
    </div>
  );
}
