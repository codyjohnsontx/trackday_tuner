'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/components/ui/device-value';
import { Input } from '@/components/ui/input';
import { Card, CardGroup, Eyebrow, GroupRow } from '@/components/ui/surface';
import { HandoverStatus } from '@/components/service-book/handover-status';
import { useRiderClock } from '@/components/service-book/rider-clock';
import { createServiceBookHandover } from '@/lib/actions/service-book-transfers';
import { buildServiceBookView, type ServiceBookData } from '@/lib/service-book/book-data';
import { parseNumberText } from '@/lib/service-book/format';
import {
  countHandover,
  describeHandover,
  HANDOVER_LINK_DAYS,
  handoverReadingDefaults,
  isHandoverEmailShape,
  type HandoverExtraCounts,
  type ServiceBookHandoverRow,
} from '@/lib/service-book/handover';
import { nicknameConfirmationMatches } from '@/lib/vehicle-delete';

interface ServiceBookHandoverFormProps {
  vehicleId: string;
  nickname: string;
  data: ServiceBookData;
  extra: HandoverExtraCounts;
  /** The book's one pending link, if one is out: then there is no form, only its state and Cancel (TQ4). */
  pending: ServiceBookHandoverRow | null;
}

/**
 * The handover screen (owner, PQ2): what goes over, counted off the book's own
 * read; what stays; the buyer's email; the reading at handover, prefilled from
 * the book's usage; and the bike's nickname typed to confirm, the gate the
 * delete form already uses. On submit the link is shown once, with Copy and
 * the phone's share sheet - no email is sent (PQ1).
 *
 * The counts need the rider's clock (two of them are honest-history labels),
 * so the summary renders after mount; nothing is pressed or prefilled until
 * the view exists, and a reading the rider has typed is never overwritten.
 *
 * The pending state is rendered here rather than by the page, because the
 * create action revalidates the page and the server's re-render arrives in
 * the same response: a component swapped out by that re-render would take
 * the once-shown link with it. This one stays mounted and keeps it.
 */
export function ServiceBookHandoverForm({ vehicleId, nickname, data, extra, pending }: ServiceBookHandoverFormProps) {
  const clock = useRiderClock();
  const view = useMemo(() => (clock ? buildServiceBookView(data, clock) : null), [data, clock]);
  const description = useMemo(() => (view ? describeHandover(countHandover(data, view, extra)) : null), [data, view, extra]);
  const unit = data.book.distance_unit;
  const { tracks_hours: tracksHours, tracks_distance: tracksDistance } = data.book;

  const [email, setEmail] = useState('');
  const [hours, setHours] = useState('');
  const [distance, setDistance] = useState('');
  const [readingTouched, setReadingTouched] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ handover: ServiceBookHandoverRow; url: string } | null>(null);
  const [cancelledId, setCancelledId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  // The prefill arrives with the clock, and follows the book until the rider
  // types a figure; one they have typed stays. Set while rendering rather than
  // in an effect, so the prefilled form is the first one painted. `view` is
  // rebuilt whenever `data` is, so keying on it also covers the two flags.
  const [prefilledFrom, setPrefilledFrom] = useState<typeof view>(null);
  if (view && !readingTouched && prefilledFrom !== view) {
    setPrefilledFrom(view);
    const defaults = handoverReadingDefaults(view);
    setHours(tracksHours ? defaults.hours : '');
    setDistance(tracksDistance ? defaults.distance : '');
  }

  // Only the browser knows whether it can share, so the server and the
  // hydrating render both go without the button.
  const canShare = useHydrated() && typeof navigator.share === 'function';

  const parsedHours = parseNumberText(hours);
  const parsedDistance = parseNumberText(distance);
  const readingValid =
    parsedHours.ok && parsedDistance.ok && (parsedHours.value ?? 0) >= 0 && (parsedDistance.value ?? 0) >= 0;
  const confirmed = nicknameConfirmationMatches(typed, nickname);
  const ready = view !== null && isHandoverEmailShape(email) && readingValid && confirmed && !isPending;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !parsedHours.ok || !parsedDistance.ok) return;
    setError('');
    setCopied(false);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    startTransition(async () => {
      const result = await createServiceBookHandover(vehicleId, {
        email,
        hours: parsedHours.value,
        distance: parsedDistance.value,
        timeZone,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({ handover: result.data.handover, url: `${window.location.origin}/transfer/${result.data.token}` });
    });
  }

  function startOver(handoverId: string) {
    setCancelledId(handoverId);
    setCreated(null);
    setCopied(false);
    setEmail('');
    setTyped('');
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function share(url: string) {
    try {
      await navigator.share({ title: `${nickname} service book handover`, url });
    } catch {
      // The rider closed the sheet; the link is still on screen.
    }
  }

  if (created) {
    return (
      <div className="space-y-5">
        <CardGroup eyebrow="Handover link" title="Send this to the buyer">
          <GroupRow className="space-y-3">
            <p className="text-sm text-ink-dim">
              The buyer signs in with {created.handover.to_email_normalized} and accepts. Copy the link now: it is not shown again, and it
              lasts {HANDOVER_LINK_DAYS} days.
            </p>
            <input
              readOnly
              value={created.url}
              aria-label="Handover link"
              data-testid="handover-link-url"
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-11 w-full rounded-control bg-surface-3 px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => copy(created.url)}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              {canShare ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => share(created.url)}>
                  Share…
                </Button>
              ) : null}
            </div>
          </GroupRow>
          <HandoverStatus vehicleId={vehicleId} handover={created.handover} onCancelled={() => startOver(created.handover.id)} />
        </CardGroup>
        <Card>
          <p className="text-sm text-ink-dim">
            Nothing changes for you until the buyer accepts: {nickname} is still yours to log on. Cancel the link above to send a different one.
          </p>
        </Card>
      </div>
    );
  }

  if (pending && pending.id !== cancelledId) {
    return (
      <section className="space-y-3 rounded-card bg-surface p-2" data-testid="handover-pending">
        <HandoverStatus vehicleId={vehicleId} handover={pending} onCancelled={() => startOver(pending.id)} />
        <p className="px-3 pb-2 text-sm text-ink-dim">
          One link at a time: cancel this one to make another. Nothing changes for you until the buyer accepts.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="handover-form">
      <CardGroup eyebrow="What goes over" title="The buyer's copy">
        {description ? (
          <>
            <GroupRow>
              <ul className="space-y-1.5 text-sm text-ink" data-testid="handover-goes-over">
                {description.goesOver.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </GroupRow>
            {description.receiptsWarning ? (
              <GroupRow>
                <p className="text-sm text-signal" data-testid="handover-receipts-warning">
                  {description.receiptsWarning}
                </p>
              </GroupRow>
            ) : null}
            <GroupRow>
              <p className="text-sm text-ink-dim">{description.staysWithYou}</p>
            </GroupRow>
            <GroupRow>
              <p className="text-sm text-ink-dim">{description.youKeep}</p>
            </GroupRow>
          </>
        ) : (
          <GroupRow>
            <p className="text-sm text-ink-faint">Counting what goes over…</p>
          </GroupRow>
        )}
      </CardGroup>

      <Card className="space-y-4">
        <Eyebrow>The buyer</Eyebrow>
        <Input
          label="Buyer's email"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          helperText="The account that accepts has to be signed in with this address."
          required
          disabled={isPending}
        />
      </Card>

      {tracksHours || tracksDistance ? (
        <Card className="space-y-4">
          <Eyebrow>Reading at handover</Eyebrow>
          <p className="text-sm text-ink-dim">
            Optional. Written as the closing reading of your copy and the opening reading of the buyer&apos;s, from the book&apos;s usage today.
          </p>
          <div className={tracksHours && tracksDistance ? 'grid grid-cols-2 gap-3' : ''}>
            {tracksHours ? (
              <Input
                label="Hours"
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={hours}
                onChange={(event) => {
                  setReadingTouched(true);
                  setHours(event.target.value);
                }}
                disabled={isPending}
              />
            ) : null}
            {tracksDistance ? (
              <Input
                label={`Distance (${unit})`}
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={distance}
                onChange={(event) => {
                  setReadingTouched(true);
                  setDistance(event.target.value);
                }}
                disabled={isPending}
              />
            ) : null}
          </div>
          {!readingValid ? (
            <p className="text-sm text-slower" role="alert">
              A reading has to be a number of zero or more.
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card className="space-y-4">
        <Eyebrow>Confirm</Eyebrow>
        <Input
          label={`Type ${nickname} to confirm`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={isPending}
        />
        <Button type="submit" fullWidth loading={isPending} disabled={!ready}>
          {isPending ? 'Making the link…' : 'Make the handover link'}
        </Button>
        {error ? (
          <p className="text-sm text-slower" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    </form>
  );
}
