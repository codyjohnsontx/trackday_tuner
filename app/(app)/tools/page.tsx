import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { CardGroup } from '@/components/ui/surface';

function ToolRow({
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
      className="group flex items-center gap-4 rounded-row bg-surface-2 p-4 transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-dim">{description}</p>
      </div>
      <ChevronRight
        className="h-5 w-5 shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-ink"
        aria-hidden
      />
    </Link>
  );
}

export default function ToolsPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Tools" sub="Dedicated calculators and utilities for trackside setup work." />

      <CardGroup eyebrow="Calculators">
        <ToolRow
          title="Unit Converter"
          description="Fast pressure, temperature, torque, mass, and volume conversions."
          href="/tools/converter"
        />
        <ToolRow
          title="Sag Calculator"
          description="Calculate free/static and rider/race sag in mm and % of travel."
          href="/sag"
        />
      </CardGroup>

      <CardGroup eyebrow="Utilities">
        <ToolRow
          title="Tracks"
          description="Manage seeded and custom tracks used in session logging."
          href="/tracks"
        />
      </CardGroup>
    </div>
  );
}
