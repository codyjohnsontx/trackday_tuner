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
      className="block rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/80"
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
        <h1 className="text-2xl font-bold text-zinc-100">Pit Tools</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Calculators and utilities for trackside setup work.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Calculators</h2>
        <ToolCard
          title="Unit Converter"
          description="Fast pressure, temperature, torque, mass, and volume conversions."
          href="/tools/converter"
        />
        <ToolCard
          title="Sag Calculator"
          description="Calculate free/static and rider/race sag in mm and % of travel."
          href="/sag"
        />
        <ToolCard
          title="AI Tuning Q&A"
          description="Ask tuning questions informed by setup knowledge and your session history."
          href="/tools/rag"
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Utilities</h2>
        <ToolCard
          title="Tracks"
          description="Manage built-in and custom tracks used across your sessions."
          href="/tracks"
        />
      </section>
    </div>
  );
}
