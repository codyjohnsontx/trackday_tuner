import Link from 'next/link';
import { Lock } from 'lucide-react';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { Button } from '@/components/ui/button';

interface SessionCompareUpgradeCardProps {
  sessionId: string;
}

export function SessionCompareUpgradeCard({ sessionId }: SessionCompareUpgradeCardProps) {
  return (
    <section className="rounded-card bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-row border border-signal/30 bg-signal/12 text-signal">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-ink">Rich session comparison is a Pro feature.</h2>
          <p className="mt-2 text-sm leading-6 text-ink-dim">
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
