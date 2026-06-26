import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SessionComparePageHeaderProps {
  sessionId: string;
  trackName: string;
  sessionLabel: string;
  dateLabel: string;
}

export function SessionComparePageHeader({
  sessionId,
  trackName,
  sessionLabel,
  dateLabel,
}: SessionComparePageHeaderProps) {
  return (
    <header className="space-y-3">
      <Button asChild variant="ghost" size="sm" className="min-h-11 px-0">
        <Link href={`/sessions/${sessionId}`}>
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Session detail
        </Link>
      </Button>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Session comparison</p>
        <h1 className="mt-1 text-2xl font-bold text-zinc-100">{trackName}</h1>
        <p className="mt-0.5 text-sm text-zinc-400">
          {dateLabel} · {sessionLabel}
        </p>
      </div>
    </header>
  );
}
