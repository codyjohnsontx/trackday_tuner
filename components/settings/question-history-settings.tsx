'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PreferenceToggle } from '@/components/settings/preference-toggle';
import { Button } from '@/components/ui/button';
import { GroupRow } from '@/components/ui/surface';
import {
  deleteAllRetainedQuestions,
  deleteRetainedQuestion,
  setQuestionRetention,
} from '@/lib/actions/ai-question-retention';
import { QUESTION_RETENTION_COPY } from '@/lib/ai-question-retention-copy';
import type { QuestionRetentionChoice, RetainedQuestionHistory } from '@/lib/ai-question-retention';

const COPY = QUESTION_RETENTION_COPY.settings;

const OPTIONS = [
  { value: 'keep' as const, label: COPY.options.keep },
  { value: 'off' as const, label: COPY.options.off },
];

export const QUESTION_HISTORY_ANCHOR = 'question-history';

interface QuestionHistorySettingsProps {
  /** `null` until the rider has seen the notice and so has not chosen. */
  choice: QuestionRetentionChoice | null;
  /** `null` when the read failed, which is not the same as holding nothing. */
  history: RetainedQuestionHistory | null;
  demoMode: boolean;
}

// A date the rider reads, in their own locale and zone. Only the browser knows
// either, so the text is formatted after mount and the server renders the
// machine-readable `dateTime` alone. Formatting on both sides and suppressing
// the mismatch left the server's calendar day on screen after hydration for a
// rider whose day differs from the server's.
export function RiderDate({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}

/**
 * The rider's control over the text of their AI questions: the switch, the
 * list of what is held, and a delete for each row and for all of them.
 */
export function QuestionHistorySettings({ choice, history, demoMode }: QuestionHistorySettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingChoice, setPendingChoice] = useState<QuestionRetentionChoice | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: () => void) {
    setErrorMessage('');
    startTransition(async () => {
      const result = await action();
      done();
      if (!result.ok) setErrorMessage(result.error);
      router.refresh();
    });
  }

  function handleChoice(next: QuestionRetentionChoice) {
    if (isPending || demoMode || (next === 'keep' && choice === 'keep')) return;
    setPendingChoice(next);
    run(() => setQuestionRetention(next), () => setPendingChoice(null));
  }

  function handleDelete(requestId: string) {
    if (isPending) return;
    setDeletingId(requestId);
    run(() => deleteRetainedQuestion(requestId), () => setDeletingId(null));
  }

  function handleDeleteAll() {
    if (isPending) return;
    run(() => deleteAllRetainedQuestions(), () => undefined);
  }

  return (
    <PreferenceToggle
      id={QUESTION_HISTORY_ANCHOR}
      title={COPY.title}
      description={COPY.description}
      label={COPY.label}
      groupLabel={COPY.title}
      options={OPTIONS}
      value={pendingChoice ?? choice}
      onChange={handleChoice}
      disabled={demoMode || isPending}
    >
      <div className="mt-4 space-y-3">
        {demoMode ? (
          <p className="text-sm text-ink-dim">{COPY.demo}</p>
        ) : choice === null ? (
          <p className="text-sm text-ink-dim">{COPY.undecided}</p>
        ) : null}

        {errorMessage ? (
          <p role="alert" className="text-sm text-slower">
            {errorMessage}
          </p>
        ) : null}

        {demoMode ? null : (
          <section aria-labelledby="question-history-list" className="space-y-2">
            <h3 id="question-history-list" className="text-sm font-medium text-ink">
              {COPY.listHeading}
            </h3>
            {history === null ? (
              <p className="text-sm text-slower">{COPY.loadFailed}</p>
            ) : history.questions.length === 0 ? (
              <p className="text-sm text-ink-dim">{COPY.empty}</p>
            ) : (
              <>
                {history.total > history.questions.length ? (
                  <p className="text-sm text-ink-dim">{COPY.truncated(history.questions.length, history.total)}</p>
                ) : null}
                <ul className="space-y-2">
                  {history.questions.map((question) => (
                    <li key={question.requestId}>
                      <GroupRow className="flex items-start justify-between gap-3 p-3">
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs text-ink-faint">
                            {COPY.routes[question.route] ?? question.route} · <RiderDate iso={question.createdAt} />
                          </p>
                          <p className="break-words text-sm text-ink">{question.text ?? '-'}</p>
                          <p className="text-xs text-ink-faint">
                            {COPY.deletedUntil} <RiderDate iso={question.retainUntil} />
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="shrink-0"
                          aria-label={`${COPY.deleteRow}: ${question.text ?? COPY.routes[question.route] ?? question.route}`}
                          onClick={() => handleDelete(question.requestId)}
                          loading={deletingId === question.requestId}
                          disabled={isPending}
                        >
                          {COPY.deleteRow}
                        </Button>
                      </GroupRow>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="destructive"
                  fullWidth
                  holdToConfirm
                  holdingLabel={COPY.deleteAllHolding}
                  onConfirm={handleDeleteAll}
                  disabled={isPending}
                >
                  {COPY.deleteAll}
                </Button>
              </>
            )}
          </section>
        )}
      </div>
    </PreferenceToggle>
  );
}
