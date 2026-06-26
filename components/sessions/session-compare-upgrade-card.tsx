import Link from 'next/link';
import { Lock } from 'lucide-react';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { Button } from '@/components/ui/button';

interface SessionCompareUpgradeCardProps {
  sessionId: string;
}

export function SessionCompareUpgradeCard({ sessionId }: SessionCompareUpgradeCardProps) {
  return (
    <section className="rounded-2xl border border-cyan-900/70 bg-zinc-900/70 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-800/70 bg-cyan-950/30 text-cyan-300">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Rich session comparison is a Pro feature.</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Your current previous-session comparison is still available on the session detail page.
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <UpgradeToProButton fullWidth />
        <Button asChild variant="secondary" fullWidth>
          <Link href={`/sessions/${sessionId}`}>Back to session detail</Link>
        </Button>
      </div>
    </section>
  );
}
