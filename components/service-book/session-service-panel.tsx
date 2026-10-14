'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/surface';
import { useRiderClock } from '@/components/service-book/rider-clock';
import { SessionWeightChoiceRow } from '@/components/service-book/session-weight';
import {
  describeSessionDuePush,
  describeSessionDuePushText,
  weightChoiceOf,
  SESSION_WEIGHT_CHOICES,
  type ServiceDueData,
} from '@/lib/service-book/reminders';

interface SessionServicePanelProps {
  sessionId: string;
  vehicleId: string;
  /** The bike's book rows, or `null` when the bike has no book: then there is nothing to count toward. */
  data: ServiceDueData | null;
  demoMode: boolean;
}

/**
 * The session page's service card: the nudge the owner asked for (Q8, "right
 * after logging a session that pushes an item past due") and the rider's word
 * on how hard the day was. The banner is derived on render from the book's
 * rows - nothing is written on the session write path - and it clears the
 * moment the rider says the day did not count, because a day weighted 0 pushed
 * nothing (`describeSessionDuePush`).
 *
 * In demo the card states the weight and offers no control, so a visitor is
 * never handed a save that refuses.
 */
export function SessionServicePanel({ sessionId, vehicleId, data, demoMode }: SessionServicePanelProps) {
  const clock = useRiderClock();
  // The weight the rider just saved, shown ahead of the server's next render:
  // see `useStoredWeight` in session-weight.tsx for why the page cannot wait
  // for it. A fresh `data` from the server replaces it.
  const [served, setServed] = useState(data);
  const [savedWeight, setSavedWeight] = useState<number | null>(null);
  if (served !== data) {
    setServed(data);
    setSavedWeight(null);
  }
  const effective = useMemo(() => {
    if (!data || savedWeight === null) return data;
    const others = data.weights.filter((row) => row.session_id !== sessionId);
    return { ...data, weights: [...others, { session_id: sessionId, weight: savedWeight, minutes_override: null, distance_override: null }] };
  }, [data, savedWeight, sessionId]);
  const pushed = useMemo(() => (clock && effective ? describeSessionDuePush(effective, sessionId, clock) : []), [clock, effective, sessionId]);
  if (!data || !effective) return null;

  const weight = effective.weights.find((row) => row.session_id === sessionId)?.weight ?? null;
  const bannerText = describeSessionDuePushText(pushed);
  const storedChoice = weightChoiceOf(weight);
  const storedLabel = SESSION_WEIGHT_CHOICES.find((choice) => choice.value === storedChoice)?.label ?? null;

  return (
    <Card>
      <Eyebrow>Service</Eyebrow>
      {bannerText ? (
        <div className="mt-2 rounded-row bg-signal/12 p-4" role="status" data-testid="service-due-banner">
          <p className="text-sm font-semibold text-signal">{bannerText}</p>
          <p className="mt-1 text-sm text-ink-dim">Log it, snooze it in the book, or say this day did not count.</p>
          {demoMode ? null : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/garage/${vehicleId}/book/entries/new`}>Log service</Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/garage/${vehicleId}/book`}>Open the book</Link>
              </Button>
            </div>
          )}
        </div>
      ) : null}
      <div className="mt-3">
        {demoMode ? (
          <p className="text-sm text-ink-dim">
            Counts toward service as {storedLabel ? storedLabel.toLowerCase() : 'a normal day'}.
          </p>
        ) : (
          <SessionWeightChoiceRow vehicleId={vehicleId} sessionId={sessionId} weight={weight} onSaved={setSavedWeight} />
        )}
      </div>
    </Card>
  );
}
