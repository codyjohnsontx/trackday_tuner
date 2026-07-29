import Link from 'next/link';
import { DemoBanner } from '@/components/demo/demo-banner';

interface DemoReadOnlyNoticeProps {
  backHref: '/garage' | '/sessions' | '/tracks';
  backLabel: string;
}

export function DemoReadOnlyNotice({ backHref, backLabel }: DemoReadOnlyNoticeProps) {
  return (
    <div className="space-y-5">
      <DemoBanner />
      <section className="rounded-card bg-surface p-5">
        <h2 className="text-lg font-semibold text-ink">Read-only demo</h2>
        <p className="mt-2 text-sm text-ink-dim">
          Demo mode is read-only. Start a real account to create or edit this item.
        </p>
        <Link
          href={backHref}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-row bg-surface-3 px-4 text-sm font-semibold text-ink transition hover:bg-surface focus-visible:ring-2 focus-visible:ring-signal/80"
        >
          {backLabel}
        </Link>
      </section>
    </div>
  );
}
