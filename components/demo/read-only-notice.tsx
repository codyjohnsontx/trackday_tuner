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
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="text-lg font-semibold text-zinc-100">Read-only demo</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Demo mode is read-only. Start a real account to create or edit this item.
        </p>
        <Link
          href={backHref}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-cyan-400/80"
        >
          {backLabel}
        </Link>
      </section>
    </div>
  );
}
