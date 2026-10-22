'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChoiceRow } from '@/components/ui/choice-row';
import { setSessionUsageWeight } from '@/lib/actions/service-book';
import {
  SESSION_WEIGHT_CHOICES,
  weightChoiceOf,
  weightOfChoice,
  type SessionWeightChoice,
} from '@/lib/service-book/reminders';
import { cn } from '@/lib/utils';

/**
 * How much a session counts toward the bike's service usage (owner,
 * 2026-10-08: "a day at a smaller track won't warrant an oil change but a big
 * day somewhere like cota would. But allow the user to make that decision").
 *
 * Two presentations of the one write: a `ChoiceRow` on the session page, where
 * the nudge lands, and a native select in the book's usage panel, where a day
 * is one row among several. Both show the STORED weight - nothing pressed when
 * the rider has not said - because a default is not an answer
 * (`lib/session-answers.ts`); the usage math reads an unsaid weight as a normal
 * day, and the helper line says so.
 */

/**
 * The weight a control shows: the stored one the server rendered, replaced by
 * the one the rider just saved until the server's next render arrives. The
 * server action revalidates the page, but the client router was measured
 * dropping that re-render on the session page in a share of saves (production
 * build, 2026-10-14), which left the control and the notice reading the rows
 * from before the click. A save the server confirmed is the rider's stored
 * word, so it is shown from here; a fresh render replaces it with what the
 * server read. The drop itself was React losing a Suspense ping, fixed by the
 * React that Next 16.3 and later vendor (CLAUDE.md, "The Service Book"); this
 * stays because a confirmed save read back at once is the better screen.
 */
function useStoredWeight(weight: number | null): [number | null, (saved: number) => void] {
  const [served, setServed] = useState(weight);
  const [local, setLocal] = useState(weight);
  if (served !== weight) {
    setServed(weight);
    setLocal(weight);
  }
  return [local, setLocal];
}

function useWeightSave(vehicleId: string, sessionId: string, onSaved: ((weight: number) => void) | undefined) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isPending, setPending] = useState(false);

  async function save(choice: SessionWeightChoice) {
    setError('');
    setPending(true);
    try {
      const weight = weightOfChoice(choice);
      const result = await setSessionUsageWeight(vehicleId, sessionId, { weight });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved?.(result.data.weight);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return { error, isPending, save };
}

interface SessionWeightProps {
  vehicleId: string;
  sessionId: string;
  /** The stored weight, or `null` when the rider has not said. */
  weight: number | null;
  /** Called with the weight the server confirmed, so a parent can recompute from it. */
  onSaved?: (weight: number) => void;
}

/** The session page's row: "Count this day toward service". */
export function SessionWeightChoiceRow({ vehicleId, sessionId, weight, onSaved }: SessionWeightProps) {
  const [stored, setStored] = useStoredWeight(weight);
  const { error, isPending, save } = useWeightSave(vehicleId, sessionId, (saved) => {
    setStored(saved);
    onSaved?.(saved);
  });
  const [pending, setPending] = useState<SessionWeightChoice | null>(null);
  const storedChoice = weightChoiceOf(stored);
  const value = isPending ? pending : storedChoice;

  return (
    <div className="space-y-2" data-testid="session-weight" data-weight={stored ?? ''}>
      <ChoiceRow
        label="Count this day toward service"
        options={SESSION_WEIGHT_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
        value={value}
        onChange={(choice) => {
          setPending(choice);
          void save(choice);
        }}
        className={cn(isPending && 'opacity-70')}
      />
      <p className="text-xs text-ink-faint">
        {stored === null
          ? 'Counts as a normal day until you say otherwise.'
          : 'Your call, and it stays yours if you back-fill history later.'}
      </p>
      {error ? (
        <p className="text-sm text-slower" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface SessionWeightSelectProps extends SessionWeightProps {
  /** Names the session for assistive tech, e.g. its date. */
  label: string;
}

/** The usage panel's control, one per counted session. */
export function SessionWeightSelect({ vehicleId, sessionId, weight, label, onSaved }: SessionWeightSelectProps) {
  const [stored, setStored] = useStoredWeight(weight);
  const { error, isPending, save } = useWeightSave(vehicleId, sessionId, (saved) => {
    setStored(saved);
    onSaved?.(saved);
  });
  const id = useId();
  const storedChoice = weightChoiceOf(stored);

  return (
    <div className="shrink-0">
      <select
        id={id}
        aria-label={`Counts as, ${label}`}
        value={storedChoice ?? ''}
        disabled={isPending}
        onChange={(event) => {
          const choice = event.target.value as SessionWeightChoice | '';
          if (choice !== '') void save(choice);
        }}
        className="min-h-11 rounded-control bg-surface-3 px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80 disabled:opacity-50"
        data-testid="session-weight-select"
      >
        <option value="" disabled>
          Normal (unsaid)
        </option>
        {SESSION_WEIGHT_CHOICES.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      {error ? (
        <p className="mt-1 text-xs text-slower" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
