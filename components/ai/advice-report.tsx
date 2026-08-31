import { RefusalCard } from '@/components/ai/refusal-card';
import { SafetyBanner } from '@/components/ai/safety-banner';
import { WatchItems } from '@/components/ai/watch-items';
import { formatComponentLabel, formatDirectionLabel } from '@/lib/rag/component-vocabulary';
import type { AdviceResponse } from '@/lib/rag/schema';
import { cn } from '@/lib/utils';

/**
 * One place an `AdviceResponse` becomes a screen.
 *
 * Every AI surface receives the identical payload from `completeAdvice`, which
 * runs `ensureSafetyNotes` so a response always carries its safety notes. They
 * had grown three independent renderers between them and each printed a
 * different subset: the Morning Plan dropped the tradeoffs and the personal
 * evidence, and the Race Engineer demo dropped the safety notes, the whole
 * prediction, the personal evidence, the data-used chips and the citations. So
 * a rider read "Decrease · 0.5 psi" with none of the caveats the model attached
 * to it, while the same payload elsewhere carried all of them.
 *
 * Sharing the three small pieces was not enough, and that is the lesson: a
 * panel could still forget a field the payload grew. Rendering the whole
 * response in one place means a new field is added once and cannot be omitted
 * by one surface, which is what `tests/unit/advice-report-completeness.test.ts`
 * holds it to.
 */

const DATA_USED_LABELS: Record<string, string> = {
  manual: 'Manual Input',
  weather: 'Weather Data',
  history: 'Session History',
  feedback: 'Past Feedback',
  lap_data: 'Lap Data',
  telemetry: 'Telemetry',
};

interface AdviceReportProps {
  advice: AdviceResponse;
  /** Heading over the model's prose - "Summary" on Race Engineer, "Plan" on the Morning Plan. */
  summaryHeading: string;
  /**
   * Copy for the refusal card. The message is always `advice.refusal`, so a
   * surface can choose its own wording without being able to drop the reason.
   */
  refusal: { title: string; helpTitle: string; examples: string[] };
  /**
   * Rendered in place of the recommendation list when the model returned none.
   * A refusal already explains itself, so this is for the surface where "no
   * change needed" is a real answer and the rider needs telling what to do.
   */
  emptyChangesMessage?: string;
}

export function AdviceReport({ advice, summaryHeading, refusal, emptyChangesMessage }: AdviceReportProps) {
  const refusalMessage = advice.refusal?.trim();
  const isRefusal = Boolean(refusalMessage);
  const hasRecommendations = advice.recommended_changes.length > 0;

  return (
    <div className="space-y-4">
      <SafetyBanner />

      {isRefusal ? (
        <RefusalCard
          title={refusal.title}
          message={refusalMessage!}
          helpTitle={refusal.helpTitle}
          examples={refusal.examples}
        />
      ) : (
        <>
          <div>
            <h3 className="text-sm font-semibold text-ink">{summaryHeading}</h3>
            <p className="mt-1 text-sm text-ink whitespace-pre-wrap">{advice.summary}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-ink-faint">
              Confidence: <span className="text-ink-dim">{advice.confidence}</span>
            </p>
          </div>

          {hasRecommendations ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">Recommended change</h3>
              <ul className="mt-2 space-y-3">
                {advice.recommended_changes.map((change, idx) => (
                  <li key={`${change.component}-${idx}`} className="rounded-row bg-surface-2 p-3">
                    {/* The wire vocabulary is identifiers; what a rider reads is not. */}
                    <p className="text-sm font-medium text-ink">{formatComponentLabel(change.component)}</p>
                    <p className="text-sm text-ink-dim">
                      {formatDirectionLabel(change.direction)} · {change.magnitude}
                    </p>
                    <p className="mt-1 text-sm text-ink-dim">{change.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : emptyChangesMessage ? (
            <div className="rounded-row border border-dashed border-white/5 bg-surface-2 p-3 text-sm text-ink-faint">
              {emptyChangesMessage}
            </div>
          ) : null}

          {advice.tradeoffs.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">Tradeoffs</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-dim">
                {advice.tradeoffs.map((tradeoff, idx) => (
                  <li key={idx}>{tradeoff}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {advice.prediction ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">Prediction</h3>
              <div className="mt-2 space-y-2 rounded-row bg-surface-2 p-3 text-sm text-ink-dim">
                <p>{advice.prediction.expected_effect}</p>
                <p className="text-ink-dim">{advice.prediction.day_trend}</p>
                <WatchItems items={advice.prediction.watch_items} />
              </div>
            </div>
          ) : null}

          {advice.personal_evidence.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">Personal evidence</h3>
              <ul className="mt-2 space-y-2 text-sm text-ink-dim">
                {advice.personal_evidence.map((evidence, idx) => (
                  <li key={idx} className="rounded-row bg-surface-2 p-3">
                    <p className="font-medium text-ink">{evidence.label}</p>
                    <p className="mt-1 text-ink-dim">{evidence.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold text-ink">Data used</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(advice.data_used).map(([key, used]) => (
                <span
                  key={key}
                  className={cn(
                    'rounded-plate px-2 py-1 text-xs font-medium',
                    used ? 'bg-surface-3 text-ink' : 'bg-surface-2 text-ink-faint',
                  )}
                >
                  {DATA_USED_LABELS[key] ?? key}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Outside the branch on purpose: a withheld answer is exactly when the
          rider is most likely to go and change something anyway. */}
      {advice.safety_notes.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-ink">Safety notes</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-dim">
            {advice.safety_notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isRefusal && advice.citations.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-ink">Citations</h3>
          <ul className="mt-2 space-y-2 text-sm text-ink-dim">
            {advice.citations.map((citation, idx) => (
              <li key={idx} className="rounded-row bg-surface-2 p-2">
                <p className="font-mono text-xs text-ink-dim">{citation.source}</p>
                <p className="mt-1 text-sm text-ink">{citation.snippet}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
