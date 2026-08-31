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
  // A refusal replaces the result, so everything belonging to the withheld
  // answer goes with it. The safety notes do not: they are the one thing a
  // rider still needs when the answer they came for was not given.
  if (refusal) return [refusal, ...value.safety_notes];

  return [
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
