import Link from 'next/link';
import { QUESTION_RETENTION_COPY } from '@/lib/ai-question-retention-copy';

const COPY = QUESTION_RETENTION_COPY.inline;

interface QuestionRetentionLineProps {
  /** Whether this rider's question text is kept, from their profile. */
  keeping: boolean;
}

/**
 * The line under a question box saying whether what the rider is about to type
 * is kept. It reads the rider's own state, so the screen never claims to keep
 * what the database will not, or the reverse. A rider who has not seen the
 * notice yet has nothing kept, so they read the "off" line.
 */
export function QuestionRetentionLine({ keeping }: QuestionRetentionLineProps) {
  return (
    <p className="text-xs text-ink-faint" data-question-retention={keeping ? 'keeping' : 'off'}>
      {keeping ? (
        <>
          {COPY.keeping}{' '}
          <Link
            href="/settings#question-history"
            className="underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          >
            {COPY.keepingLink}
          </Link>
        </>
      ) : (
        COPY.off
      )}
    </p>
  );
}
