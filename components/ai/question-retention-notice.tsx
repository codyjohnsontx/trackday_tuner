'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/surface';
import {
  acknowledgeQuestionRetentionNotice,
  setQuestionRetention,
} from '@/lib/actions/ai-question-retention';
import { QUESTION_RETENTION_COPY } from '@/lib/ai-question-retention-copy';

const COPY = QUESTION_RETENTION_COPY.notice;

interface QuestionRetentionNoticeProps {
  /** This rider starts with keeping off, so the notice asks rather than tells. */
  requiresOptIn: boolean;
}

/**
 * The one-time notice every rider sees before anything they type is kept
 * (owner decision on L1/L2). It stays on every screen of the app until they
 * answer it, and nothing of theirs is kept while it does: the keep rule needs
 * `notice_seen_at`, and only an answer here or on the Settings card sets it.
 *
 * Either answer records the notice as seen. For a rider who keeps by default,
 * "Got it" keeps and "Do not keep" turns it off; for one who starts with it
 * off, "Keep for 90 days" turns it on and "Not now" leaves it off.
 */
export function QuestionRetentionNotice({ requiresOptIn }: QuestionRetentionNoticeProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<'primary' | 'secondary' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  function answer(which: 'primary' | 'secondary') {
    if (isPending) return;
    setErrorMessage('');
    setPendingAction(which);
    startTransition(async () => {
      const result = requiresOptIn
        ? which === 'primary'
          ? await setQuestionRetention('keep')
          : await acknowledgeQuestionRetentionNotice()
        : which === 'primary'
          ? await acknowledgeQuestionRetentionNotice()
          : await setQuestionRetention('off');
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
        {requiresOptIn ? COPY.optInTitle : COPY.title}
      </h2>
      <p className="mt-2 text-sm text-ink-dim">{requiresOptIn ? COPY.optInBody : COPY.body}</p>
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
        {/* Where keeping has to be asked for, both answers carry equal
            weight: a white fill on "Keep" would lean on the answer. */}
        <Button
          type="button"
          variant={requiresOptIn ? 'secondary' : 'primary'}
          onClick={() => answer('primary')}
          loading={pendingAction === 'primary'}
          disabled={isPending}
        >
          {requiresOptIn ? COPY.optIn : COPY.acknowledge}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => answer('secondary')}
          loading={pendingAction === 'secondary'}
          disabled={isPending}
        >
          {requiresOptIn ? COPY.notNow : COPY.decline}
        </Button>
      </div>
    </section>
  );
}
