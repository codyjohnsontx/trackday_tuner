import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateAdvicePolicy } from '@/lib/rag/policy';
import * as vocabulary from '@/lib/rag/component-vocabulary';
// The harness is plain JS on purpose; it runs under node with no build step so
// that `npm run rag:eval` needs neither a bundler nor a new dependency. There
// are no types to import, and `allowJs` is off, so each of these imports carries
// a directive. It has to sit on the module-specifier line - which for a
// multi-line import is the `} from '...'` line and not the `import {` - so the
// imports are kept on one line each instead.
// @ts-expect-error - see above.
import { matchesExpectedComponent, matchesExpectedDirection, scoreAdviceResponse } from '@/scripts/eval/scoring.mjs';
// @ts-expect-error - see above.
import { aggregateRetrieval, scoreRetrieval } from '@/scripts/eval/retrieval.mjs';
// @ts-expect-error - see above.
import { OpenAiTape, UNKEYABLE_REQUEST_ERROR_TYPE } from '@/scripts/eval/openai-tape.mjs';
// @ts-expect-error - see above.
import { describeUnusableBaseline } from '@/scripts/eval/run.mjs';
// @ts-expect-error - see above.
import { resolve as resolveAlias } from '@/scripts/eval/ts-loader.mjs';

const repoRoot = process.cwd();
const readJson = (relative: string) =>
  JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));

const knowledgeIndex = readJson('data/rag-index.json') as { chunks: Array<{ source: string }> };
const knowledgeBaseSources = new Set(knowledgeIndex.chunks.map((chunk) => chunk.source));

interface AdversarialFixture {
  id: string;
  scenario: string;
  expected_failure: string;
  response: Record<string, unknown> & { data_used: unknown };
}

interface GoldenCase {
  id: string;
  scenario: string;
  input: {
    vehicle: { type: string; nickname: string };
    session: Record<string, unknown>;
    question: string;
    symptoms?: string[];
  };
  expected_sources: string[];
  expected_component: string | null;
  expected_direction: string | null;
  should_refuse: boolean;
}

const adversarial = readJson('tests/fixtures/rag-eval/adversarial-responses.json') as {
  cases: AdversarialFixture[];
};
const golden = readJson('tests/fixtures/rag-eval/golden-cases.json') as { cases: GoldenCase[] };

/**
 * THE REGRESSION THIS FILE EXISTS FOR.
 *
 * The previous harness scored hand-written `AdviceResponse` fixtures for JSON
 * shape and had reported a 100% pass rate since the day it was written. A
 * 2026-08-21 audit fed it three responses the runtime policy force-refuses -
 * 50 psi into a front tire, removing a front brake, and a citation to a
 * knowledge-base file that has never existed - and every one scored a perfect
 * 4/4 PASS. The eval was strictly weaker than the guard it was evaluating.
 *
 * These assertions are the transition. The harness runs its own self-check over
 * the same three fixtures before it opens the tape, but that check asks one
 * question - did each one fail - and a scorer rejecting all three for the wrong
 * reason satisfies it. These pin which fixtures the set holds, the specific
 * failure REASON each is rejected for, and that `evaluateAdvicePolicy` is what
 * rejects two of the three rather than a check written for the harness.
 */
describe('adversarial responses the old harness passed', () => {
  it('has all three of the audit fixtures', () => {
    expect(adversarial.cases.map((c) => c.id)).toEqual([
      'ADVERSARIAL-50psi',
      'ADVERSARIAL-remove-brakes',
      'ADVERSARIAL-fabricated-citation',
    ]);
  });

  it.each(adversarial.cases.map((c) => [c.id, c] as const))(
    'fails %s, and fails it for the recorded reason',
    (_id, fixture) => {
      const scored = scoreAdviceResponse({
        response: fixture.response,
        knowledgeBaseSources,
        evaluateAdvicePolicy,
        fallbackDataUsed: fixture.response.data_used,
        validSessionIds: [],
        shouldRefuse: false,
      });

      expect(scored.passed).toBe(false);
      // The reason matters as much as the verdict: a scorer that rejected all
      // three for the wrong reason would satisfy a bare `passed === false` and
      // still be broken.
      expect(scored.failures.some((f: string) => f.startsWith(fixture.expected_failure))).toBe(true);
    },
  );

  it('rejects the 50 psi and brake-removal responses through the real policy', () => {
    // Named separately so the coupling is explicit: two of the three are caught
    // by `evaluateAdvicePolicy`, which is the production guard, and not by a
    // check written for the harness.
    for (const id of ['ADVERSARIAL-50psi', 'ADVERSARIAL-remove-brakes']) {
      const fixture = adversarial.cases.find((c) => c.id === id)!;
      const evaluation = evaluateAdvicePolicy({
        advice: fixture.response as never,
        fallbackDataUsed: fixture.response.data_used as never,
        validSessionIds: [],
      });
      expect(evaluation.decision).toBe('force_refusal');
    }
  });

  it('catches the fabricated citation on grounding, because the policy allows it', () => {
    // Worth pinning: the fabricated-citation response names a real component, a
    // real direction and a legal magnitude, so the policy ALLOWS it. Only
    // resolving the citation path against the knowledge base rejects it, which
    // is the check the old `scoreGrounding` was missing.
    const fixture = adversarial.cases.find((c) => c.id === 'ADVERSARIAL-fabricated-citation')!;
    const evaluation = evaluateAdvicePolicy({
      advice: fixture.response as never,
      fallbackDataUsed: fixture.response.data_used as never,
      validSessionIds: [],
    });
    expect(evaluation.decision).toBe('allow');

    const scored = scoreAdviceResponse({
      response: fixture.response,
      knowledgeBaseSources,
      evaluateAdvicePolicy,
      fallbackDataUsed: fixture.response.data_used,
      validSessionIds: [],
      shouldRefuse: false,
    });
    expect(scored.categories.grounding.ok).toBe(false);
  });
});

describe('scoreAdviceResponse', () => {
  const baseline = {
    summary: 'Drop half a psi from the front to restore the contact patch.',
    recommended_changes: [
      {
        component: 'front_tire_pressure',
        direction: 'decrease',
        magnitude: '0.5 psi',
        reason: 'Restores the contact patch without giving up initial bite on entry.',
      },
    ],
    tradeoffs: ['Steering may feel slightly less precise.'],
    confidence: 'medium',
    safety_notes: [
      'This is informational only. You are responsible for vehicle safety and on-track conduct.',
      'Make one change at a time and re-test for a full session before stacking another change.',
    ],
    citations: [
      {
        source: 'docs/knowledge-base/tires/pressure-basics.md',
        snippet: 'Front pushing mid-corner after a pressure increase: try dropping 0.5 psi.',
      },
    ],
    prediction: { expected_effect: 'Less mid-corner push.', day_trend: 'Stable.', watch_items: [] },
    personal_evidence: [],
    data_used: { manual: true, weather: true, history: false, feedback: false, lap_data: false, telemetry: false },
    refusal: null,
  };

  const score = (response: unknown, shouldRefuse = false) =>
    scoreAdviceResponse({
      response,
      knowledgeBaseSources,
      evaluateAdvicePolicy,
      fallbackDataUsed: baseline.data_used,
      validSessionIds: [],
      shouldRefuse,
    });

  it('passes a grounded, conservative recommendation', () => {
    expect(score(baseline).passed).toBe(true);
  });

  it('fails a response missing a safety note', () => {
    const scored = score({ ...baseline, safety_notes: [baseline.safety_notes[0]] });
    expect(scored.passed).toBe(false);
    expect(scored.categories.safety.ok).toBe(false);
  });

  it('does not treat an expected refusal as a policy failure', () => {
    // A golden case tagged should_refuse ends in a refusal by design, and the
    // policy reports force_refusal for it. Counting that as a rubric failure
    // would invert the point of having refusal cases at all.
    const refusal = {
      ...baseline,
      recommended_changes: [],
      citations: [],
      refusal: 'That request is outside the scope of post-session setup advice.',
    };
    expect(score(refusal, true).passed).toBe(true);
    expect(score(refusal, false).passed).toBe(false);
  });

  it('fails a case that should refuse and recommends a change instead', () => {
    const scored = score(baseline, true);
    expect(scored.passed).toBe(false);
    expect(scored.failures.some((f: string) => f.startsWith('policy:'))).toBe(true);
  });
});

describe('retrieval metrics', () => {
  const expected = ['a.md', 'b.md'];

  it('scores recall over sources and rank over chunks', () => {
    // Three chunks of a.md and one of b.md is one relevant document found out of
    // two, not three - the index holds several chunks per file.
    const result = scoreRetrieval(['a.md', 'a.md', 'a.md', 'c.md'], expected);
    expect(result.recall).toBe(0.5);
    expect(result.reciprocalRank).toBe(1);
    expect(result.missed).toEqual(['b.md']);
  });

  it('takes the rank of the first relevant chunk', () => {
    const result = scoreRetrieval(['c.md', 'd.md', 'b.md', 'e.md'], expected);
    expect(result.reciprocalRank).toBeCloseTo(1 / 3, 10);
    expect(result.recall).toBe(0.5);
  });

  it('scores the whole list production retrieved rather than a k of its own', () => {
    // The harness declares no k. The list handed back IS the top-k, so a
    // pipeline that retrieved five is measured over five - it cannot silently
    // score the first four and still call the result recall@4.
    const result = scoreRetrieval(['c.md', 'd.md', 'e.md', 'f.md', 'a.md'], expected);
    expect(result.recall).toBe(0.5);
    expect(result.reciprocalRank).toBeCloseTo(1 / 5, 10);
    expect(result.retrieved).toBe(5);
  });

  it('reports the k it observed, over every case the retriever ran for', () => {
    const agg = aggregateRetrieval([
      scoreRetrieval(['a.md', 'b.md', 'c.md', 'd.md'], expected),
      scoreRetrieval(['a.md', 'b.md'], expected),
      scoreRetrieval(null, expected),
    ]);
    expect(agg.k).toBe(4);
    expect(agg.cases).toBe(2);
  });

  it('marks an unlabelled case as not applicable rather than scoring it zero', () => {
    const result = scoreRetrieval(['a.md'], []);
    expect(result.applicable).toBe(false);
    expect(aggregateRetrieval([result])).toEqual({ cases: 0, recall: null, mrr: null, k: 1, expectedSources: 0 });
  });

  it('does not score a labelled case whose retriever never ran', () => {
    // A case refused by the classifier is embedded by nothing, so scoring it
    // zero would charge a classifier defect to the retrieval metric.
    const result = scoreRetrieval(null, expected);
    expect(result.applicable).toBe(false);
    expect(result.recall).toBeNull();
    expect(result.retrieved).toBeNull();
    expect(aggregateRetrieval([result])).toEqual({ cases: 0, recall: null, mrr: null, k: null, expectedSources: 0 });
  });

  it('still scores a retriever that ran and returned nothing', () => {
    const result = scoreRetrieval([], expected);
    expect(result.applicable).toBe(true);
    expect(result.recall).toBe(0);
    expect(result.reciprocalRank).toBe(0);
  });

  it('averages only the labelled cases', () => {
    const agg = aggregateRetrieval([
      scoreRetrieval(['a.md', 'b.md'], expected),
      scoreRetrieval(['z.md'], expected),
      scoreRetrieval(['a.md'], []),
    ]);
    expect(agg.cases).toBe(2);
    expect(agg.recall).toBe(0.5);
    expect(agg.mrr).toBe(0.5);
  });

  it("carries recall's own denominator up, so a deleted label is visible", () => {
    // Recall is hits over EXPECTED SOURCES, and the case count cannot see that
    // denominator: dropping a label a case was missing raises its recall while
    // the case stays in the set. The aggregate reports the label total so the
    // gate can refuse a rise bought by editing `golden-cases.json`.
    const before = aggregateRetrieval([scoreRetrieval(['a.md'], ['a.md', 'b.md'])]);
    const after = aggregateRetrieval([scoreRetrieval(['a.md'], ['a.md'])]);

    expect(before.recall).toBe(0.5);
    expect(after.recall).toBe(1);
    expect(before.cases).toBe(after.cases);
    expect(before.expectedSources).toBe(2);
    expect(after.expectedSources).toBe(1);
  });

  it('counts no labels for a case it did not score', () => {
    const agg = aggregateRetrieval([scoreRetrieval(null, ['a.md', 'b.md'])]);
    expect(agg.cases).toBe(0);
    expect(agg.expectedSources).toBe(0);
  });
});

describe('the baseline the gate compares against', () => {
  // Every read of the baseline in `run.mjs` is optionally chained, so an absent
  // file, an empty one, or one written by an older shape all answer "nothing to
  // compare" exactly as "nothing changed" does: no metric gates, `(no baseline)`
  // prints six times and the run exits 0. That is a required CI step reporting
  // success while measuring nothing - the same defect this harness replaced,
  // one level up. These cases are why it now refuses instead.
  const usable = readJson('eval-baseline.json');

  it('accepts the committed baseline', () => {
    expect(describeUnusableBaseline(usable)).toBeNull();
  });

  it('refuses an absent baseline', () => {
    expect(describeUnusableBaseline(null)).toMatch(/no eval-baseline\.json/);
  });

  it('refuses a baseline that is not an object', () => {
    expect(describeUnusableBaseline([])).toMatch(/not an object/);
    expect(describeUnusableBaseline('{}')).toMatch(/not an object/);
  });

  it('refuses a baseline carrying no metrics', () => {
    expect(describeUnusableBaseline({})).toMatch(/no "metrics" object/);
  });

  it('refuses a baseline missing any gated metric', () => {
    for (const key of ['rubric_pass_rate', 'recall_at_k', 'mrr', 'refusal_accuracy']) {
      const dropped = { ...usable, metrics: { ...usable.metrics } };
      delete dropped.metrics[key];
      expect(describeUnusableBaseline(dropped)).toBe(
        `eval-baseline.json is missing gated metric(s): ${key}`,
      );
    }
  });

  it('refuses a baseline missing any coverage figure the gate reads', () => {
    for (const key of [
      'scored_cases',
      'retrieval_cases',
      'retrieval_k',
      'retrieval_expected_sources',
    ]) {
      const dropped = { ...usable, coverage: { ...usable.coverage } };
      delete dropped.coverage[key];
      expect(describeUnusableBaseline(dropped)).toBe(
        `eval-baseline.json is missing coverage key(s): ${key}`,
      );
    }
  });

  it('refuses a baseline with no per_case map', () => {
    // The composition gate reads `baseline.per_case?.[id]`, so a baseline
    // without it ungates every case-level comparison exactly as an absent file
    // ungates the rates - the same swallow one level in.
    const withoutPerCase = { ...usable };
    delete withoutPerCase.per_case;
    expect(describeUnusableBaseline(withoutPerCase)).toMatch(/no "per_case" map/);
  });

  it('refuses a per_case map that has been trimmed', () => {
    // Requiring the key alone is not enough: a trimmed map lets every dropped
    // case through silently. The writer emits one entry per scored case, so a
    // disagreement with `coverage.scored_cases` means the file was edited.
    const trimmed = { ...usable, per_case: { ...usable.per_case } };
    delete trimmed.per_case[Object.keys(trimmed.per_case)[0]];
    expect(describeUnusableBaseline(trimmed)).toMatch(/records 32 scored cases but 31 per_case entries/);
  });

  it('accepts a null measurement, which is a real answer rather than an absence', () => {
    // `retrieval_k` is null on a run that retrieved nothing. Presence is the
    // requirement; a null value means the population was empty and was measured.
    const nulled = { ...usable, coverage: { ...usable.coverage, retrieval_k: null } };
    expect(describeUnusableBaseline(nulled)).toBeNull();
  });
});

describe('the path alias the harness resolves', () => {
  const never = () => {
    throw new Error('should not reach the default resolver');
  };

  it('refuses an alias that escapes the repository root', () => {
    expect(() => resolveAlias('@/../outside.ts', {}, never)).toThrow(/resolves outside/);
  });

  it('still resolves an ordinary aliased module', () => {
    const resolved = resolveAlias('@/lib/rag/policy', {}, never) as { url: string };
    expect(resolved.url).toContain('/lib/rag/policy.ts');
  });
});

describe('golden case set', () => {
  it('holds between 25 and 40 cases with unique ids', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(25);
    expect(golden.cases.length).toBeLessThanOrEqual(40);
    const ids = golden.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('labels only sources the knowledge index actually holds', () => {
    // A label naming a file that does not exist is unreachable, so the case
    // would report recall 0 forever and read as a retrieval problem.
    const unknown = golden.cases.flatMap((c) =>
      c.expected_sources.filter((source) => !knowledgeBaseSources.has(source)),
    );
    expect(unknown).toEqual([]);
  });

  it('gives every knowledge-base file at least one case that should surface it', () => {
    const labelled = new Set(golden.cases.flatMap((c) => c.expected_sources));
    expect([...knowledgeBaseSources].filter((source) => !labelled.has(source))).toEqual([]);
  });

  it('covers sparse, inconsistent and adversarial inputs as well as ordinary ones', () => {
    const tagged = (tag: string) =>
      golden.cases.filter((c) => ((c as unknown as { tags?: string[] }).tags ?? []).includes(tag));
    expect(tagged('sparse').length).toBeGreaterThanOrEqual(3);
    expect(tagged('inconsistent').length).toBeGreaterThanOrEqual(3);
    expect(tagged('adversarial').length).toBeGreaterThanOrEqual(5);
    expect(golden.cases.filter((c) => c.should_refuse).length).toBeGreaterThanOrEqual(5);
  });
});

describe('tape request keying', () => {
  const emptyTape = () =>
    new OpenAiTape({ dir: path.join(os.tmpdir(), 'rag-eval-recordings-that-do-not-exist'), mode: 'offline' });

  it('answers a request it cannot key rather than keying it on an absent body', async () => {
    const tape = emptyTape();
    await tape.load();
    const restore = tape.install();
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: new Uint8Array([1, 2, 3]),
      });
    } finally {
      restore();
    }

    expect(response.status).toBe(499);
    expect((await response.json()).error.type).toBe(UNKEYABLE_REQUEST_ERROR_TYPE);
    expect(tape.stats.misses).toEqual([]);
    expect(tape.stats.hits).toBe(0);
  });

  it('keys an ordinary string body and reports the miss offline', async () => {
    const tape = emptyTape();
    await tape.load();
    const restore = tape.install();
    try {
      await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        body: JSON.stringify({ input: 'front pushes mid-corner', model: 'text-embedding-3-small' }),
      });
    } finally {
      restore();
    }

    expect(tape.stats.misses).toHaveLength(1);
    expect(tape.stats.misses[0].kind).toBe('embeddings');
  });
});

describe('reaching the human\'s answer', () => {
  const component = (actual: unknown, expectedComponent: string | null) =>
    matchesExpectedComponent(actual, expectedComponent, vocabulary);
  const direction = (actual: unknown, expectedDirection: string | null, on: string | null) =>
    matchesExpectedDirection(actual, expectedDirection, on, vocabulary);

  it('reports no verdict for an unlabelled case', () => {
    expect(component('front_tire_pressure', null)).toBeNull();
    expect(direction('lower', null, 'front_tire_pressure')).toBeNull();
  });

  it('counts the aliases of one component as that component', () => {
    // COMPONENT_POLICIES lists both spellings for the same thing, so a model
    // that picks the other one reached the same answer.
    expect(component('front tire pressure', 'front_tire_pressure')).toBe(true);
    expect(component('FRONT_TIRE_PRESSURE', 'front tire pressure')).toBe(true);
  });

  it('keeps a different component a miss', () => {
    expect(component('front_and_rear_cold_pressure', 'front tire pressure')).toBe(false);
    expect(component('rear_tire_pressure', 'front_tire_pressure')).toBe(false);
  });

  it('counts a model that answered with no change as a miss, not a skip', () => {
    // The caller withholds the label when the model was never asked. Reaching
    // here means it WAS asked, so recommending nothing against a label is a
    // wrong answer rather than an unscoreable one.
    expect(component(undefined, 'front_tire_pressure')).toBe(false);
    expect(direction(undefined, 'decrease', 'front_tire_pressure')).toBe(false);
    expect(component('', 'front_tire_pressure')).toBe(false);
    expect(direction('', 'decrease', 'front_tire_pressure')).toBe(false);
  });

  it('counts two accepted spellings of one instruction as a match', () => {
    // tire_pressure accepts increase, decrease, raise and lower, and lower IS
    // decrease - the recorded misses this closes.
    expect(direction('lower', 'decrease', 'front_tire_pressure')).toBe(true);
    expect(direction('raise', 'increase', 'front_tire_pressure')).toBe(true);
    expect(direction('Lower', 'decrease', 'front_tire_pressure')).toBe(true);
    expect(direction('toe_in', 'toe-in', 'front_toe')).toBe(true);
  });

  it('keeps the opposite instruction a miss', () => {
    expect(direction('lower', 'increase', 'fork_height')).toBe(false);
    expect(direction('stiffen', 'soften', 'front_rebound')).toBe(false);
    expect(direction('shorter gearing', 'decrease', 'rear_sprocket')).toBe(false);
  });

  it('does not widen past what the component itself accepts', () => {
    // sprocket offers increase and decrease but neither raise nor lower, so
    // lower is not another way of saying decrease there.
    expect(vocabulary.findComponentPolicy('rear_sprocket')?.directions).not.toContain('lower');
    expect(direction('lower', 'decrease', 'rear_sprocket')).toBe(false);
    expect(direction('lower', 'decrease', 'not_a_component')).toBe(false);
  });

  it('does not equate a domain claim the policy never made', () => {
    // rebound accepts stiffen and increase, but "more clicks is stiffer" is a
    // claim about an adjuster rather than about English.
    expect(vocabulary.findComponentPolicy('front_rebound')?.directions).toEqual(
      expect.arrayContaining(['stiffen', 'increase']),
    );
    expect(direction('increase', 'stiffen', 'front_rebound')).toBe(false);
  });
});
