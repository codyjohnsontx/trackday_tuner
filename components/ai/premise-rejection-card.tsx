import { Eyebrow } from '@/components/ui/surface';

/**
 * What a rider sees when they proposed something the app will not help them do,
 * and is being helped anyway.
 *
 * THE TENSION THIS COMPONENT EXISTS TO RESOLVE. The captain chose "reject the
 * premise, then help" over a clean refusal because a refusal that only says no
 * leaves the rider still holding the problem that made them ask. That choice
 * only pays if the rejection actually LANDS, and it is on the same screen as
 * ordinary setup advice - so the risk it buys is that the safety sentence reads
 * as a disclaimer the rider scrolls past to reach the answer.
 *
 * WHAT SEPARATES A WARNING FROM A DISCLAIMER, and what each difference is built
 * out of here:
 *
 * - A DISCLAIMER IS CONSTANT. `SafetyBanner` carries identical text above every
 *   answer, so a rider learns its shape in three sessions and stops reading it.
 *   This block appears only when they asked for something specific, and it says
 *   what that was. Contingency is the difference the rider actually notices.
 * - A DISCLAIMER IS FOOTNOTE-SIZED. `SafetyBanner` is a one-line chip:
 *   `text-xs`, amber on amber, no heading. This is a card with `text-base`
 *   primary ink - the largest, highest-contrast text on the screen, larger than
 *   the summary it sits above. Nothing else in an `AdviceReport` is `text-base`.
 * - A DISCLAIMER SITS BESIDE THE ANSWER. This one OWNS it: the pivot line is
 *   inside this card, so the recommendation below reads as what to do INSTEAD
 *   rather than as the answer to the question that was asked. That is the second
 *   half of the captain's shape ("Heavy turn-in is usually geometry or front
 *   tyre pressure. Here's where I'd start:") and it is fixed copy here rather
 *   than model prose, because the join between the rejection and the help must
 *   not be something a model can decline to write.
 *
 * The amber is a solid left rule rather than a tinted fill, so the two blocks
 * are not two amber panels stacked. `app/globals.css` reserves `signal` for
 * interaction and caution, and reserves uppercase eyebrows for `ink-faint`, so
 * the rule carries the caution and the eyebrow carries the label.
 *
 * The pivot is suppressed when the answer was withheld anyway - promising help
 * that is not below would be worse than saying nothing.
 */
interface PremiseRejectionCardProps {
  /** The deterministic sentence from `lib/rag/premise-guard.ts`. */
  message: string;
  /** Whether a recommendation follows. False on a refusal, where nothing does. */
  hasAnswerBelow: boolean;
}

export function PremiseRejectionCard({ message, hasAnswerBelow }: PremiseRejectionCardProps) {
  return (
    <div className="rounded-row border-l-2 border-signal bg-surface-2 p-4">
      <Eyebrow>Not a setup change</Eyebrow>
      <p className="mt-2 text-base font-medium leading-snug text-ink">{message}</p>
      {hasAnswerBelow ? (
        <p className="mt-3 text-sm text-ink-dim">
          Here is what I would look at for the handling you described instead.
        </p>
      ) : null}
    </div>
  );
}
