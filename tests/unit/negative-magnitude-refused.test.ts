import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdviceReport } from '@/components/ai/advice-report';
import { evaluateAdvicePolicy } from '@/lib/rag/policy';
import type { AdviceResponse } from '@/lib/rag/schema';

/**
 * The rider-facing half of tt-negative-magnitude-accepted, kept as the
 * regression test because the defect is what reaches the SCREEN.
 *
 * `magnitude` is deliberately rendered unformatted - the display/wire split on
 * `formatDirectionLabel` records why - so whatever clears `evaluateAdvicePolicy`
 * is printed verbatim beside a canonical direction. Before the fix this walk
 * returned `allow` and `AdviceReport` printed `Soften · -1 click`: an
 * instruction with no safe reading, on a value a rider acts on at a track day.
 *
 * This renders to static markup, so it is structural evidence that the string
 * never reaches the rider rather than a claim about how the page looks. The
 * guard itself is exercised case by case in lib/rag/component-vocabulary.test.ts
 * and the violation it raises in lib/rag/policy.test.ts.
 */

function advice(magnitude: string): AdviceResponse {
  return {
    summary: 'Front grip fell away mid-corner as the session went on.',
    recommended_changes: [
      {
        component: 'front_rebound',
        direction: 'soften',
        magnitude,
        reason: 'Recover front grip without a large setup swing.',
      },
    ],
    tradeoffs: ['Too soft a rebound setting can leave the front wallowing.'],
    confidence: 'medium',
    safety_notes: ['This is informational only.'],
    citations: [
      {
        source: 'docs/knowledge-base/suspension/rebound-vs-compression.md',
        snippet: 'Soften front rebound to recover mid-corner grip.',
      },
    ],
    prediction: {
      expected_effect: 'More front grip next session.',
      day_trend: 'No day trend was provided.',
      watch_items: [],
    },
    personal_evidence: [],
    data_used: {
      manual: true,
      weather: false,
      history: false,
      feedback: false,
      lap_data: false,
      telemetry: false,
    },
    refusal: null,
  };
}

function riderText(response: AdviceResponse): string {
  const html = renderToStaticMarkup(
    createElement(AdviceReport, {
      advice: response,
      summaryHeading: 'Summary',
      refusal: {
        title: 'Could not answer',
        helpTitle: 'Try something like:',
        examples: ['A question about your own session.'],
      },
    }),
  );
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('a negative magnitude never reaches the rider', () => {
  it('refuses the recommendation rather than printing "Soften · -1 click"', () => {
    const input = advice('-1 click');
    const result = evaluateAdvicePolicy({ advice: input, fallbackDataUsed: input.data_used });

    expect(result.decision).toBe('force_refusal');
    const text = riderText(result.advice);
    expect(text).not.toContain('-1 click');
    expect(text).not.toContain('Soften');
  });

  it('refuses the same instruction spelled with a minus sign rather than a hyphen', () => {
    const input = advice('−1 click');
    const result = evaluateAdvicePolicy({ advice: input, fallbackDataUsed: input.data_used });

    expect(result.decision).toBe('force_refusal');
    const text = riderText(result.advice);
    expect(text).not.toContain('−1 click');
    expect(text).not.toContain('Soften');
  });

  it('still serves the same recommendation written positively', () => {
    const input = advice('1 click');
    const result = evaluateAdvicePolicy({ advice: input, fallbackDataUsed: input.data_used });

    expect(result.decision).toBe('allow');
    expect(riderText(result.advice)).toContain('Soften · 1 click');
  });
});
