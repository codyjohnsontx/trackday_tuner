import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdviceReport } from '@/components/ai/advice-report';
import { DayPlanAdviceResult, demoDayPlanAdvice } from '@/components/ai/day-plan-panel';
import { demoTuningAdvice } from '@/components/ai/tuning-advice-panel';
import type { AdviceResponse } from '@/lib/rag/schema';

/**
 * Every AI surface receives the identical `AdviceResponse` from `completeAdvice`,
 * which runs `ensureSafetyNotes` so a response always carries its safety notes.
 * Three renderers had grown between two panels and each printed a different
 * subset. Verified in the browser before the fix, against the two demo fixtures
 * this file also renders:
 *
 * - the Morning Plan on /sessions printed the summary, the recommendation, the
 *   prediction, the data-used chips and the safety notes, and dropped the
 *   tradeoffs and the personal evidence;
 * - the Race Engineer demo branch on a session page printed the summary, the
 *   recommendation and the tradeoffs, and dropped the safety notes, the whole
 *   prediction, the personal evidence, the data-used chips and the citations.
 *
 * The suite has no DOM, so this renders to static markup: structural evidence
 * that the strings reach the rider, not that they are legible on screen.
 */

const REFUSAL_COPY = {
  title: 'Could not answer',
  helpTitle: 'Try something like:',
  examples: ['A question about your own session.'],
};

function advice(partial: Partial<AdviceResponse> = {}): AdviceResponse {
  return {
    summary: 'Start from the Session 3 baseline and watch rear grip as the track heats up.',
    recommended_changes: [
      {
        component: 'rear_tire_pressure',
        direction: 'decrease',
        magnitude: '0.5 psi',
        reason: 'The hottest session lost exit drive as pressure and track temperature rose.',
      },
    ],
    tradeoffs: ['Chasing rear grip with pressure can reduce carcass support if taken too far.'],
    confidence: 'medium',
    safety_notes: ['Make one change at a time.', 'Confirm pressure targets with your tire vendor.'],
    citations: [{ source: 'kb/tire-pressure.md', snippet: 'Hot pressure targets move with track temp.' }],
    prediction: {
      expected_effect: 'Turn-in should stay while late-session rear greasiness drops.',
      day_trend: 'Track temperature is the main watch item.',
      watch_items: ['Rear drive after lap four'],
    },
    personal_evidence: [
      { label: 'Session 3', detail: 'Lower front pressure improved turn-in.', source_session_id: 's3' },
    ],
    data_used: {
      manual: true,
      weather: true,
      history: true,
      feedback: false,
      lap_data: false,
      telemetry: false,
    },
    refusal: null,
    ...partial,
  };
}

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

/**
 * Every string a response can put in front of a rider. A renderer that omits a
 * block fails here rather than shipping the omission, which is the whole reason
 * the three renderers became one.
 */
function everyRiderFacingString(value: AdviceResponse): string[] {
  const refusal = value.refusal?.trim();
  const premiseRejection = value.premise_rejection?.trim();
  // A refusal replaces the result, so everything belonging to the withheld
  // answer goes with it. The safety notes do not: they are the one thing a
  // rider still needs when the answer they came for was not given. Neither does
  // a premise rejection, and for a stronger version of the same reason - it is
  // about something the rider proposed doing, not about the answer.
  if (refusal) {
    return [refusal, ...value.safety_notes, ...(premiseRejection ? [premiseRejection] : [])];
  }

  return [
    ...(premiseRejection ? [premiseRejection] : []),
    value.summary,
    ...value.recommended_changes.map((change) => change.magnitude),
    ...value.recommended_changes.map((change) => change.reason),
    ...value.tradeoffs,
    ...value.safety_notes,
    ...(value.prediction ? [value.prediction.expected_effect, value.prediction.day_trend] : []),
    ...(value.prediction?.watch_items ?? []),
    ...value.personal_evidence.flatMap((evidence) => [evidence.label, evidence.detail]),
    ...value.citations.flatMap((citation) => [citation.source, citation.snippet]),
  ];
}

function expectComplete(html: string, value: AdviceResponse) {
  for (const text of everyRiderFacingString(value)) {
    expect(html).toContain(text);
  }
}

describe('AdviceReport renders the whole response', () => {
  it('shows every block a model answer can carry', () => {
    const value = advice();
    const html = render(createElement(AdviceReport, { advice: value, summaryHeading: 'Plan', refusal: REFUSAL_COPY }));

    expectComplete(html, value);
    expect(html).toContain('Tradeoffs');
    expect(html).toContain('Prediction');
    expect(html).toContain('Personal evidence');
    expect(html).toContain('Safety notes');
    expect(html).toContain('Citations');
    // The static disclaimer, which is not part of the payload.
    expect(html).toContain('Informational only.');
  });

  it('renders identifiers as labels a rider reads', () => {
    const html = render(
      createElement(AdviceReport, { advice: advice(), summaryHeading: 'Plan', refusal: REFUSAL_COPY }),
    );

    expect(html).toContain('Rear tire pressure');
    expect(html).toContain('Decrease');
    expect(html).not.toContain('rear_tire_pressure');
  });

  /**
   * A withheld answer is exactly when a rider is most likely to go and change
   * something anyway, so the safety notes stay on the refusal branch. The
   * citations do not: they belong to an answer that was not given.
   */
  it('keeps the safety notes on a refusal and drops the citations', () => {
    const value = advice({ refusal: 'That question is outside setup advice.', recommended_changes: [] });
    const html = render(createElement(AdviceReport, { advice: value, summaryHeading: 'Plan', refusal: REFUSAL_COPY }));

    expectComplete(html, value);
    expect(html).toContain('Could not answer');
    expect(html).toContain('Try something like:');
    expect(html).not.toContain('kb/tire-pressure.md');
    expect(html).not.toContain(value.summary);
    expect(html).not.toContain(value.tradeoffs[0]);
    expect(html).not.toContain(value.personal_evidence[0].detail);
  });

  it('says what to do instead when a surface has no recommendation to show', () => {
    const html = render(
      createElement(AdviceReport, {
        advice: advice({ recommended_changes: [] }),
        summaryHeading: 'Plan',
        refusal: REFUSAL_COPY,
        emptyChangesMessage: 'No specific setup change recommended yet.',
      }),
    );

    expect(html).toContain('No specific setup change recommended yet.');
    expect(html).not.toContain('Recommended change');
  });

  it('omits a block the response does not carry', () => {
    const html = render(
      createElement(AdviceReport, {
        advice: advice({ tradeoffs: [], personal_evidence: [], citations: [], safety_notes: [] }),
        summaryHeading: 'Plan',
        refusal: REFUSAL_COPY,
      }),
    );

    expect(html).not.toContain('Tradeoffs');
    expect(html).not.toContain('Personal evidence');
    expect(html).not.toContain('Citations');
    expect(html).not.toContain('Safety notes');
  });
});

/**
 * The captain accepted a real tension when he chose "reject the premise, then
 * help" over a clean refusal: a safety warning and ordinary setup advice end up
 * on one screen, and the warning must not read as a disclaimer the rider scrolls
 * past to reach the answer.
 *
 * The unit suite has no DOM and cannot say a block is legible, so what is locked
 * here is the structure that carries the difference - the rejection reaches the
 * rider, it comes FIRST, it is body-sized primary ink where the standing
 * disclaimer is footnote-sized amber, and it survives a withheld answer. Whether
 * it lands on a phone is a browser question and belongs in the manual e2e walk.
 */
describe('a rejected premise does not read as the standing disclaimer', () => {
  const REJECTION =
    'Removing or disabling a brake is not a setup change, and going on track without one ' +
    'is not something I can help you set up.';

  it('reaches the rider above the answer, and the answer still arrives', () => {
    const value = advice({ premise_rejection: REJECTION });
    const html = render(
      createElement(AdviceReport, { advice: value, summaryHeading: 'Summary', refusal: REFUSAL_COPY }),
    );

    expectComplete(html, value);
    // Reject the premise, THEN help: the recommendation is still on the screen.
    expect(html).toContain('Rear tire pressure');
    expect(html.indexOf(REJECTION)).toBeLessThan(html.indexOf(value.summary));
    // The pivot that makes the advice below read as "instead" rather than as an
    // answer to what was asked.
    expect(html).toContain('Here is what I would look at for the handling you described instead.');
  });

  it('is not styled like the standing disclaimer', () => {
    const html = render(
      createElement(AdviceReport, {
        advice: advice({ premise_rejection: REJECTION }),
        summaryHeading: 'Summary',
        refusal: REFUSAL_COPY,
      }),
    );

    // From the card's own opening tag through its message, so the container's
    // classes are in the slice alongside the copy's.
    const eyebrowAt = html.indexOf('Not a setup change');
    const rejectionMarkup = html.slice(
      html.lastIndexOf('<div', eyebrowAt),
      html.indexOf(REJECTION) + REJECTION.length,
    );
    // Body-sized primary ink. The standing disclaimer is `text-xs text-signal`,
    // and nothing else in an AdviceReport is `text-base`.
    expect(rejectionMarkup).toContain('text-base');
    expect(rejectionMarkup).toContain('text-ink');
    expect(rejectionMarkup).not.toContain('text-xs');
    // Both blocks are on screen, so they must not be two amber panels stacked:
    // the caution here is a rule, not a fill.
    expect(rejectionMarkup).toContain('border-signal');
    expect(rejectionMarkup).not.toContain('bg-signal');
  });

  it('survives a withheld answer, and drops the promise of help that is not there', () => {
    const value = advice({
      premise_rejection: REJECTION,
      refusal: 'I could not identify a safe, supported setup recommendation.',
      recommended_changes: [],
    });
    const html = render(
      createElement(AdviceReport, { advice: value, summaryHeading: 'Summary', refusal: REFUSAL_COPY }),
    );

    expectComplete(html, value);
    expect(html).not.toContain('Here is what I would look at');
  });
});

describe('every AI surface renders the whole response', () => {
  it('the Morning Plan shows the tradeoffs and personal evidence it used to drop', () => {
    const html = render(createElement(DayPlanAdviceResult, { advice: demoDayPlanAdvice }));

    expect(demoDayPlanAdvice.tradeoffs.length).toBeGreaterThan(0);
    expect(demoDayPlanAdvice.personal_evidence.length).toBeGreaterThan(0);
    expectComplete(html, demoDayPlanAdvice);
  });

  /**
   * The Race Engineer demo branch is what a visitor evaluating the product
   * sees, and it printed three of the eight blocks its own fixture carries.
   */
  it('the Race Engineer demo advice reaches the rider whole', () => {
    const html = render(
      createElement(AdviceReport, {
        advice: demoTuningAdvice,
        summaryHeading: 'Summary',
        refusal: REFUSAL_COPY,
      }),
    );

    expect(demoTuningAdvice.safety_notes.length).toBeGreaterThan(0);
    expect(demoTuningAdvice.citations.length).toBeGreaterThan(0);
    expectComplete(html, demoTuningAdvice);
  });
});
