'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/surface';
import { setQuestionRetention } from '@/lib/actions/ai-question-retention';
import { QUESTION_RETENTION_COPY } from '@/lib/ai-question-retention-copy';

const COPY = QUESTION_RETENTION_COPY.notice;

/**
 * The one-time notice every rider sees before anything they type is kept. It
 * stays on every screen of the app until they answer it, and nothing of theirs
 * is kept while it does: the keep rule needs `notice_seen_at`, and only an
 * answer here or on the Settings card sets it.
 *
 * Keeping is off until each rider turns it on (owner, 2026-09-25), so the
 * notice asks. Either answer records the notice as seen: "Keep for 90 days"
 * turns keeping on, and "Not now" records an explicit off, so declining never
 * rests on what `requires_opt_in` holds.
 */
export function QuestionRetentionNotice() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<'primary' | 'secondary' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // The notice sits above the page, and on the navigation that mounts it -
  // signing in, above all - the router scrolls the new page segment into view
  // whenever its top is below the fold, which on a phone leaves the rider on
  // the two answers with the text they answer scrolled away under the header.
  // Answering records the notice as seen, so bring it back into view. This is
  // a passive effect, so it runs after the router's scroll in the same commit.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  function answer(which: 'primary' | 'secondary') {
    if (isPending) return;
    setErrorMessage('');
    setPendingAction(which);
    startTransition(async () => {
      const result = await setQuestionRetention(which === 'primary' ? 'keep' : 'off');
      setPendingAction(null);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="question-retention-notice-title" className="rounded-card bg-surface p-5">
      <Eyebrow icon={ShieldCheck}>Privacy</Eyebrow>
      <h2 id="question-retention-notice-title" className="mt-2 text-base font-semibold text-ink">
        {COPY.optInTitle}
      </h2>
      <p className="mt-2 text-sm text-ink-dim">{COPY.optInBody}</p>
      <Link
        href="/privacy"
        className="mt-2 inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
      >
        {COPY.privacyLink}
      </Link>
      {errorMessage ? (
        <p role="alert" className="mt-2 text-sm text-slower">
          {errorMessage}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {/* Both answers carry equal weight: a white fill on "Keep" would
            lean on the answer. */}
        <Button
          type="button"
          variant="secondary"
          onClick={() => answer('primary')}
          loading={pendingAction === 'primary'}
          disabled={isPending}
        >
          {COPY.optIn}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => answer('secondary')}
          loading={pendingAction === 'secondary'}
          disabled={isPending}
        >
          {COPY.notNow}
        </Button>
      </div>
    </section>
  );
}
