import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateAdvicePolicy } from '@/lib/rag/policy';
import { parseAdviceResponse } from '@/lib/rag/schema';
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
import { OpenAiTape, requestKey, UNKEYABLE_REQUEST_ERROR_TYPE } from '@/scripts/eval/openai-tape.mjs';
// @ts-expect-error - see above.
import { compareAgainstBaseline, describeCaseLabels, describeUnreadableBaseline, describeUnsoundRun, describeUnusableBaseline, diffLine, prepareOpenAiApiKey } from '@/scripts/eval/run.mjs';
// @ts-expect-error - see above.
import { resolve as resolveAlias } from '@/scripts/eval/ts-loader.mjs';
// @ts-expect-error - see above.
import { aggregateContext, aggregateUsage, countWords, describeCorpus, summarizeContext, tallyMissedSources } from '@/scripts/eval/corpus-depth.mjs';

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

interface MustServeFixture {
  id: string;
  scenario: string;
  provenance: string;
  what_it_costs_the_rider: string;
  response: Record<string, unknown> & { data_used: unknown };
}

const mustServe = readJson('tests/fixtures/rag-eval/must-serve-responses.json') as {
  cases: MustServeFixture[];
};

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

/**
 * THE MIRROR OF THE SET ABOVE, and the reason it exists.
 *
 * The adversarial fixtures prove the harness can report a FAILURE. Nothing
 * proved it could report a PASS on a response a guard nearly discarded, and that
 * direction costs the rider more: a refused good answer leaves no trace but a
 * `completed_refusal_*` audit row and a pass rate that quietly falls.
 *
 * The fixture is a real recorded model output. On 2026-09-08 the model answered
 * `mc-gearing-slow-corner` correctly and then wrote the four-character STRING
 * "null" where the session reference belongs; `evaluateAdvicePolicy` read that
 * as an unverifiable session id and force-refused the whole response.
 *
 * THESE ARE PARSED AND THE ADVERSARIAL THREE ARE NOT, which is the point: the
 * fix is in `parseAdviceResponse`, so a fixture scored raw would skip the only
 * step under test. Both halves are asserted below - raw is refused, parsed is
 * served - so this cannot pass by the policy having been loosened instead.
 */
describe('responses production must serve', () => {
  it('has the placeholder-session-reference fixture', () => {
    expect(mustServe.cases.map((c) => c.id)).toEqual([
      'MUST-SERVE-placeholder-session-reference',
    ]);
  });

  it.each(mustServe.cases.map((c) => [c.id, c] as const))(
    'serves %s once the parser has run',
    (_id, fixture) => {
      const parsed = parseAdviceResponse(fixture.response);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const scored = scoreAdviceResponse({
        response: parsed.data,
        knowledgeBaseSources,
        evaluateAdvicePolicy,
        fallbackDataUsed: parsed.data.data_used,
        // The strictest setting the policy has: with no allowed ids, ANY
        // non-null source_session_id is unverifiable. Passing here means the
        // reference is genuinely absent rather than luckily matched.
        validSessionIds: [],
        shouldRefuse: false,
      });

      expect(scored.failures).toEqual([]);
      expect(scored.passed).toBe(true);
    },
  );

  it('is refused unparsed, so the parser is what rescues it', () => {
    const fixture = mustServe.cases.find(
      (c) => c.id === 'MUST-SERVE-placeholder-session-reference',
    )!;
    const evaluation = evaluateAdvicePolicy({
      advice: fixture.response as never,
      fallbackDataUsed: fixture.response.data_used as never,
      validSessionIds: [],
    });
    expect(evaluation.decision).toBe('force_refusal');
    expect(evaluation.violations).toContain('invalid_personal_evidence');
  });

  it('still refuses a reference the prompt never printed', () => {
    // The other direction, which the fix must not weaken: an id that is not a
    // placeholder is passed through untouched and the policy still refuses it.
    const fixture = mustServe.cases.find(
      (c) => c.id === 'MUST-SERVE-placeholder-session-reference',
    )!;
    const evidence = fixture.response.personal_evidence as Array<Record<string, unknown>>;
    const fabricated = parseAdviceResponse({
      ...fixture.response,
      personal_evidence: [
        { ...evidence[0], source_session_id: '99999999-9999-4999-8999-999999999999' },
      ],
    });
    expect(fabricated.ok).toBe(true);
    if (!fabricated.ok) return;

    const evaluation = evaluateAdvicePolicy({
      advice: fabricated.data,
      fallbackDataUsed: fabricated.data.data_used,
      validSessionIds: [],
    });
    expect(evaluation.decision).toBe('force_refusal');
    expect(evaluation.violations).toContain('invalid_personal_evidence');
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
    const scored = usable.coverage.scored_cases;
    expect(describeUnusableBaseline(trimmed)).toMatch(
      `records ${scored} scored cases but ${scored - 1} per_case entries`,
    );
  });

  it.each([
    ['passed', (row: Record<string, unknown>) => delete row.passed],
    ['recall', (row: Record<string, unknown>) => delete row.recall],
    ['reciprocal_rank', (row: Record<string, unknown>) => delete row.reciprocal_rank],
    ['labels', (row: Record<string, unknown>) => delete row.labels],
    ['recall mistyped', (row: Record<string, unknown>) => { row.recall = '1'; }],
    ['passed mistyped', (row: Record<string, unknown>) => { row.passed = 'true'; }],
  ])('refuses a per_case row whose %s is missing or mistyped', (_name, damage) => {
    // EVERY field the gate reads, not only `labels`. `compareAgainstBaseline`
    // reads each through optional chaining or a typeof test, so a row that lost
    // or mistyped one is treated as "no previous value" and that case is
    // silently ungated - switching off the composition and per-case retrieval
    // gates without anyone noticing.
    const damaged = {
      ...usable,
      per_case: Object.fromEntries(
        Object.entries(usable.per_case as Record<string, Record<string, unknown>>).map(
          ([id, row]) => [id, { ...row }],
        ),
      ),
    };
    damage(Object.values(damaged.per_case)[0] as Record<string, unknown>);
    expect(describeUnusableBaseline(damaged)).toMatch(/per_case field\(s\) missing or mistyped/);
  });

  it('accepts a null recall, which is a real answer for an unlabelled case', () => {
    // Null is a measurement of an empty population; a wrong TYPE is not.
    const nulled = {
      ...usable,
      per_case: Object.fromEntries(
        Object.entries(usable.per_case as Record<string, Record<string, unknown>>).map(
          ([id, row]) => [id, { ...row, recall: null, reciprocal_rank: null }],
        ),
      ),
    };
    expect(describeUnusableBaseline(nulled)).toBeNull();
  });

  it('accepts a null measurement, which is a real answer rather than an absence', () => {
    // `retrieval_k` is null on a run that retrieved nothing. Presence is the
    // requirement; a null value means the population was empty and was measured.
    const nulled = { ...usable, coverage: { ...usable.coverage, retrieval_k: null } };
    expect(describeUnusableBaseline(nulled)).toBeNull();
  });

  it('refuses a gated metric with no value over a population that was not empty', () => {
    // Presence alone is the right rule for a coverage figure and not for a
    // gated metric's value: a null `rubric_pass_rate` beside every scored case
    // leaves `previous` null, so all four rates print `(no baseline)` and the
    // run exits 0 - the exact signature this function exists to stop, reached
    // by a file that keeps every key, every coverage figure and every row.
    const nulled = { ...usable, metrics: { ...usable.metrics } };
    for (const key of ['rubric_pass_rate', 'recall_at_k', 'mrr', 'refusal_accuracy']) {
      nulled.metrics[key] = null;
    }
    const { scored_cases: scored, retrieval_cases: retrieval } = usable.coverage;
    expect(describeUnusableBaseline(nulled)).toBe(
      'eval-baseline.json has no number for gated metric(s) whose population was not empty: ' +
        `rubric_pass_rate (over ${scored} scored_cases), recall_at_k (over ${retrieval} retrieval_cases), ` +
        `mrr (over ${retrieval} retrieval_cases), refusal_accuracy (over ${scored} scored_cases)`,
    );
  });

  it('accepts a null gated metric whose own denominator is zero', () => {
    // The other direction, and rejecting it would trade one wrong for another:
    // a run that retrieved nothing measured `recall_at_k` over an empty
    // population, so null there is the measurement rather than an absence.
    const nulled = {
      ...usable,
      metrics: { ...usable.metrics, recall_at_k: null, mrr: null },
      coverage: {
        ...usable.coverage,
        retrieval_cases: 0,
        retrieval_k: null,
        retrieval_expected_sources: 0,
      },
    };
    expect(describeUnusableBaseline(nulled)).toBeNull();
  });

  it('refuses a baseline that scored no cases, which gates nothing', () => {
    // The writer could produce this from an emptied golden set: every key
    // present, every metric null, `per_case` empty and `scored_cases` 0, so it
    // satisfies every other rule here while no comparison can ever fire.
    //
    // The run-level twins of this rule - an emptied golden set and an emptied
    // adversarial set, each of which fails the run whatever flags it was given
    // - live inside `main` and need the fixtures, the tapes and the index on
    // disk, so they are proven by fault injection against the real harness
    // rather than covered here. The substance of the self-check is covered
    // above, where the three fixtures are pinned by id and each is asserted to
    // fail for its own recorded reason.
    const empty = {
      metrics: {
        rubric_pass_rate: null,
        recall_at_k: null,
        mrr: null,
        refusal_accuracy: null,
        component_accuracy: null,
        direction_accuracy: null,
      },
      coverage: {
        scored_cases: 0,
        retrieval_k: null,
        retrieval_cases: 0,
        retrieval_expected_sources: 0,
        component_cases: 0,
        direction_cases: 0,
      },
      per_case: {},
    };
    expect(describeUnusableBaseline(empty)).toBe('eval-baseline.json scored no cases, so it gates nothing');
  });
});

describe('the line printed under "Against baseline"', () => {
  it('says there is no baseline only when the baseline has no value', () => {
    expect(diffLine('recall@4', 0.81, null)).toContain('(no baseline)');
    expect(diffLine('recall@4', null, null)).toContain('(no baseline)');
  });

  it('keeps the stored figure when this run could not measure the metric', () => {
    // The file is present and readable; the metric stopped being measurable.
    // Calling that "(no baseline)" is a claim about the file and is false.
    const line = diffLine('recall@4', null, 0.8077);
    expect(line).toContain('not measured this run, was 0.81');
    expect(line).not.toContain('(no baseline)');
  });

  it('prints the delta when both are measured', () => {
    expect(diffLine('recall@4', 0.85, 0.8077)).toContain('0.81 -> 0.85 (+0.04)');
  });
});

describe('a baseline that could not be read at all', () => {
  // The read used to rethrow anything but ENOENT, which took the run down
  // before the `--update-baseline` write block - so the recovery the failure
  // message prescribes could not run until the file was deleted by hand.
  it('names an absent file, and the write does fix that', () => {
    const problem = describeUnreadableBaseline({ code: 'ENOENT' });
    expect(problem.reason).toMatch(/no eval-baseline\.json/);
    expect(problem.recoverable).toBe(true);
  });

  it('names an unparseable file, and the write does fix that', () => {
    let thrown: unknown;
    try {
      // What a conflicted `recorded_at` or `per_case` block leaves behind.
      JSON.parse('{"metrics": <<<<<<< HEAD');
    } catch (err) {
      thrown = err;
    }
    const problem = describeUnreadableBaseline(thrown);
    expect(problem.reason).toMatch(/eval-baseline\.json is not valid JSON/);
    expect(problem.recoverable).toBe(true);
  });

  it('refuses to promise that write for a file it could not read', () => {
    // `--update-baseline` writes to the same path, so it cannot clear a
    // permission or path failure and the message must not say it can.
    for (const code of ['EACCES', 'EISDIR', 'EIO']) {
      const problem = describeUnreadableBaseline({ code });
      expect(problem.reason).toContain(`could not be read (${code})`);
      expect(problem.recoverable).toBe(false);
    }
  });
});

describe('the comparison against the baseline', () => {
  const METRICS = {
    rubric_pass_rate: 0.5,
    recall_at_k: 0.5,
    mrr: 0.5,
    refusal_accuracy: 0.5,
    component_accuracy: 0.5,
    direction_accuracy: 0.5,
  };
  const COVERAGE = {
    scored_cases: 2,
    retrieval_k: 4,
    retrieval_cases: 2,
    retrieval_expected_sources: 3,
    component_cases: 2,
    direction_cases: 2,
  };
  const baseline = {
    metrics: METRICS,
    coverage: COVERAGE,
    per_case: { a: { passed: true }, b: { passed: false } },
  };
  const run = (cases: Array<[string, boolean]>) =>
    cases.map(([id, passed]) => ({
      id,
      scored: { passed },
      retrieval: { recall: null, reciprocalRank: null },
    }));

  // The retrieval half of the same composition question. `a` and `b` above
  // carry no per-case recall, so the pass/fail cases exercise the pass/fail
  // gate alone; these carry one.
  const retrievalBaseline = {
    metrics: METRICS,
    coverage: COVERAGE,
    per_case: {
      a: { passed: true, recall: 1, reciprocal_rank: 1 },
      b: { passed: true, recall: 0.5, reciprocal_rank: 0.5 },
    },
  };
  const retrievalRun = (cases: Array<[string, number | null, number | null]>) =>
    cases.map(([id, recall, reciprocalRank]) => ({
      id,
      scored: { passed: true },
      retrieval: { recall, reciprocalRank },
    }));

  it('finds nothing wrong in a run that reproduces the baseline', () => {
    const { regressions, nowFailing, leftTheSet } = compareAgainstBaseline({
      metrics: METRICS,
      coverage: COVERAGE,
      scoredResults: run([
        ['a', true],
        ['b', false],
      ]),
      baseline,
    });
    expect(regressions).toEqual([]);
    expect(nowFailing).toEqual([]);
    expect(leftTheSet).toEqual([]);
  });

  it('fails a gated metric that fell, and leaves an ungated one reported', () => {
    const { regressions, rows } = compareAgainstBaseline({
      metrics: { ...METRICS, rubric_pass_rate: 0.4, direction_accuracy: 0.1 },
      coverage: COVERAGE,
      scoredResults: run([
        ['a', true],
        ['b', false],
      ]),
      baseline,
    });
    expect(regressions).toEqual(['rubric pass rate 0.50 -> 0.40']);
    const direction = rows.find((r: { label: string }) => r.label === 'direction accuracy');
    expect(direction.gated).toBe(false);
  });

  it('fails a case that passed in the baseline and now fails, at an unmoved rate', () => {
    // The composition case: `a` goes pass -> fail while `b` goes fail -> pass,
    // so every rate and every coverage figure is identical.
    const { regressions, nowFailing } = compareAgainstBaseline({
      metrics: METRICS,
      coverage: COVERAGE,
      scoredResults: run([
        ['a', false],
        ['b', true],
      ]),
      baseline,
    });
    expect(nowFailing).toEqual(['a']);
    expect(regressions.some((line: string) => line.includes('now fail: a'))).toBe(true);
  });

  it('fails a failing case swapped out for a passing one', () => {
    // The masked form of the same swap. Failing `b` is deleted and passing `c`
    // added, so `scored_cases` stays 2 and the rubric rate RISES from 1/2 to
    // 2/2 - no coverage fall, no metric regression, and `nowFailing` never
    // consults `b` because it iterates this run's results.
    const { regressions, nowFailing, leftTheSet } = compareAgainstBaseline({
      metrics: { ...METRICS, rubric_pass_rate: 1 },
      coverage: COVERAGE,
      scoredResults: run([
        ['a', true],
        ['c', true],
      ]),
      baseline,
    });
    expect(nowFailing).toEqual([]);
    expect(leftTheSet).toEqual(['b']);
    expect(regressions.some((line: string) => line.includes('no longer scored here: b'))).toBe(true);
  });

  it('does not flag a case the golden set gained', () => {
    const { leftTheSet, regressions } = compareAgainstBaseline({
      metrics: METRICS,
      coverage: { ...COVERAGE, scored_cases: 3 },
      scoredResults: run([
        ['a', true],
        ['b', false],
        ['c', true],
      ]),
      baseline,
    });
    expect(leftTheSet).toEqual([]);
    expect(regressions).toEqual([]);
  });

  it('fails a swap that leaves recall@k and MRR exactly where they were', () => {
    // The case the gate exists for, and the one that passed before it. `a`
    // halves while `b` doubles, so both means are identical, every coverage
    // figure is identical and both cases still pass - `scoreGrounding` resolves
    // a citation against the whole index, never against `expected_sources`.
    const { regressions, retrievalFell } = compareAgainstBaseline({
      metrics: METRICS,
      coverage: COVERAGE,
      scoredResults: retrievalRun([
        ['a', 0.5, 0.5],
        ['b', 1, 1],
      ]),
      baseline: retrievalBaseline,
    });
    expect(retrievalFell).toEqual(['a recall 1.00 -> 0.50', 'a MRR 1.00 -> 0.50']);
    expect(regressions.some((line: string) => line.includes('a recall 1.00 -> 0.50'))).toBe(true);
  });

  it('does not fail a case that retrieved better', () => {
    const { regressions, retrievalFell } = compareAgainstBaseline({
      metrics: METRICS,
      coverage: COVERAGE,
      scoredResults: retrievalRun([
        ['a', 1, 1],
        ['b', 1, 1],
      ]),
      baseline: retrievalBaseline,
    });
    expect(retrievalFell).toEqual([]);
    expect(regressions).toEqual([]);
  });

  it('does not fail a case the baseline has no row for', () => {
    const { retrievalFell } = compareAgainstBaseline({
      metrics: METRICS,
      coverage: { ...COVERAGE, scored_cases: 3 },
      scoredResults: retrievalRun([
        ['a', 1, 1],
        ['b', 0.5, 0.5],
        ['c', 0, 0],
      ]),
      baseline: retrievalBaseline,
    });
    expect(retrievalFell).toEqual([]);
  });

  it('fails a case that stopped being retrieval-scored, and names it', () => {
    // Not redundant with the `retrieval_cases` coverage fall: that fires only
    // when the TOTAL drops, so one case losing its labels while another gains
    // some holds the count still and names neither.
    const { retrievalFell } = compareAgainstBaseline({
      metrics: METRICS,
      coverage: COVERAGE,
      scoredResults: retrievalRun([
        ['a', null, null],
        ['b', 0.5, 0.5],
      ]),
      baseline: retrievalBaseline,
    });
    expect(retrievalFell).toEqual(['a recall 1.00 -> not scored', 'a MRR 1.00 -> not scored']);
  });

  it('fails a gated metric that had a baseline value and is no longer measurable', () => {
    // Stated directly rather than left to the coverage checks: a metric that
    // used to be measurable and now is not has fallen, and `previous != null &&
    // current != null` silently passed it.
    const { regressions } = compareAgainstBaseline({
      metrics: { ...METRICS, recall_at_k: null, mrr: null },
      coverage: COVERAGE,
      scoredResults: run([
        ['a', true],
        ['b', false],
      ]),
      baseline,
    });
    expect(regressions).toContain('recall@4 0.50 -> not measured this run');
    expect(regressions).toContain('MRR 0.50 -> not measured this run');
  });

  it('does not fail an ungated metric that is no longer measurable', () => {
    const { regressions } = compareAgainstBaseline({
      metrics: { ...METRICS, direction_accuracy: null },
      coverage: COVERAGE,
      scoredResults: run([
        ['a', true],
        ['b', false],
      ]),
      baseline,
    });
    expect(regressions).toEqual([]);
  });

  it('fails a fall in the number of expected sources', () => {
    // Recall's denominator is labels rather than cases, so deleting a label a
    // case was missing raises that case's recall while `retrieval_cases` and
    // `scored_cases` both stand still.
    const { regressions } = compareAgainstBaseline({
      metrics: METRICS,
      coverage: { ...COVERAGE, retrieval_expected_sources: 2 },
      scoredResults: run([
        ['a', true],
        ['b', false],
      ]),
      baseline,
    });
    expect(regressions.some((line: string) => line.includes('retrieval labels 3 -> 2'))).toBe(true);
  });

  it('gates nothing at all without a baseline, which is why the read is checked', () => {
    const { regressions, nowFailing, leftTheSet } = compareAgainstBaseline({
      metrics: METRICS,
      coverage: COVERAGE,
      scoredResults: run([['a', false]]),
      baseline: null,
    });
    expect(regressions).toEqual([]);
    expect(nowFailing).toEqual([]);
    expect(leftTheSet).toEqual([]);
  });
});

describe('whether a run may write or prune', () => {
  // ONE definition with three readers: `--update-baseline` writing a baseline,
  // `--live` pruning the tape, and the exit code. All three are safe exactly
  // when the run reached every case, so they read the same function rather than
  // each keeping a copy that agrees today and drifts later.
  //
  // What this suite reaches is the DEFINITION. That a throw while scoring a case
  // is now recorded as a case error rather than unwinding the loop is a property
  // of the loop inside the unexported `main`, which needs a tape, a knowledge
  // index and the resolve hook to run; there is no cheap honest way to drive it
  // from here, and the count check below is what makes such an exit visible to
  // the guard however it happens.
  const sound = {
    selfCheckCount: 3,
    selfCheckBrokenCount: 0,
    scoredCount: 32,
    errorCount: 0,
    expectedCount: 32,
    tapeMissCount: 0,
  };

  it('permits a run that reached every case', () => {
    expect(describeUnsoundRun(sound)).toEqual([]);
  });

  it('permits a run that reached every case with one of them throwing', () => {
    // A case that threw is unsound on its own account, but it did produce a
    // verdict, so it must not ALSO read as a run that stopped early.
    const reasons = describeUnsoundRun({ ...sound, scoredCount: 31, errorCount: 1 });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/case\(s\) threw/);
  });

  it.each([
    ['the self-check had no fixtures', { selfCheckCount: 0 }, /self-check had no fixtures/],
    ['the golden set was empty', { scoredCount: 0, expectedCount: 0 }, /no cases were scored/],
    ['the scorer passed a refused response', { selfCheckBrokenCount: 1 }, /force-refuses/],
    ['a request had no recording', { tapeMissCount: 1 }, /had no recording/],
    ['a case threw', { scoredCount: 31, errorCount: 1 }, /case\(s\) threw/],
    ['the loop exited early', { scoredCount: 20 }, /stopped after 20 of 32 cases/],
  ])('refuses a run where %s', (_label, overrides, pattern) => {
    const reasons = describeUnsoundRun({ ...sound, ...(overrides as object) });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(pattern as RegExp);
  });

  it('refuses a run cut short even when every case it reached scored cleanly', () => {
    // The defect this closes: a throw after `runCase` used to leave the loop
    // with no case error and no tape miss, so the prune saw a sound run and
    // deleted the committed recordings of every case it never reached.
    const reasons = describeUnsoundRun({ ...sound, scoredCount: 12, errorCount: 0 });
    expect(reasons).toEqual(['the run stopped after 12 of 32 cases']);
  });

  it('names every reason at once rather than only the first', () => {
    // The operator fixes what it lists, so a partial list costs a whole re-run.
    expect(
      describeUnsoundRun({
        selfCheckCount: 0,
        selfCheckBrokenCount: 2,
        scoredCount: 0,
        errorCount: 1,
        expectedCount: 32,
        tapeMissCount: 4,
      }),
    ).toHaveLength(6);
  });
});

describe('a golden label change', () => {
  // MEASURED, not hypothesised: flipping one `should_refuse` from false to true
  // on a force-refused case took rubric_pass_rate and refusal_accuracy from 0.81
  // to 0.84 with 52 tape entries replayed, 0 missed and exit 0. No label is in
  // the prompt, so no tape key moves and every count check stays silent. The
  // number rose because the test got weaker, which is the defect this harness
  // exists to remove - and it is the same act as deleting a label, which was
  // already gated, with the count preserved so that gate cannot see it.
  const LABELS = {
    should_refuse: false,
    expected_premise_rejection: false,
    expected_component: 'front_tire_pressure',
    expected_direction: 'decrease',
    expected_sources: ['a.md', 'b.md'],
  };
  const METRICS_ = {
    rubric_pass_rate: 1,
    recall_at_k: 1,
    mrr: 1,
    refusal_accuracy: 1,
    component_accuracy: 1,
    direction_accuracy: 1,
  };
  const COVERAGE_ = {
    scored_cases: 1,
    retrieval_k: 4,
    retrieval_cases: 1,
    retrieval_expected_sources: 2,
    component_cases: 1,
    direction_cases: 1,
  };
  const baselineWith = (labels: unknown) => ({
    metrics: METRICS_,
    coverage: COVERAGE_,
    per_case: { a: { passed: true, recall: 1, reciprocal_rank: 1, labels } },
  });
  const runWith = (labels: unknown) => [
    { id: 'a', scored: { passed: true }, retrieval: { recall: 1, reciprocalRank: 1 }, labels },
  ];
  const compare = (baselineLabels: unknown, runLabels: unknown) =>
    compareAgainstBaseline({
      metrics: METRICS_,
      coverage: COVERAGE_,
      scoredResults: runWith(runLabels),
      baseline: baselineWith(baselineLabels),
    });

  it('is not reported when nothing changed', () => {
    const { regressions, relabelled } = compare(LABELS, LABELS);
    expect(relabelled).toEqual([]);
    expect(regressions).toEqual([]);
  });

  it.each([
    ['should_refuse', { ...LABELS, should_refuse: true }],
    ['expected_premise_rejection', { ...LABELS, expected_premise_rejection: true }],
    ['expected_component', { ...LABELS, expected_component: 'rear_tire_pressure' }],
    ['expected_direction', { ...LABELS, expected_direction: 'increase' }],
    ['expected_sources', { ...LABELS, expected_sources: ['a.md', 'c.md'] }],
  ])('is a regression when %s changes', (field, changed) => {
    // All of them, not only the one that was proven: a gate covering one label
    // and not its siblings enforces the principle in one direction only.
    // `expected_premise_rejection` is here because it decides a rubric failure
    // of its own, so editing it moves `rubric_pass_rate` with every other check
    // silent - the same mechanism proved on `should_refuse`.
    const { regressions, relabelled } = compare(LABELS, changed);
    expect(relabelled).toHaveLength(1);
    expect(relabelled[0]).toContain(field as string);
    expect(regressions.some((r: string) => r.includes('golden label change'))).toBe(true);
  });

  it('is not a regression when expected_sources is only reordered', () => {
    // The SET is what recall measures; the order it is written in is not a fact
    // about the case, so reordering must not cost a re-baseline.
    const { relabelled, regressions } = compare(LABELS, {
      ...LABELS,
      expected_sources: ['b.md', 'a.md'],
    });
    expect(relabelled).toEqual([]);
    expect(regressions).toEqual([]);
  });

  it('sorts sources and normalises absent labels when describing a case', () => {
    expect(describeCaseLabels({ expected_sources: ['b.md', 'a.md'] })).toEqual({
      should_refuse: false,
      expected_premise_rejection: false,
      expected_component: null,
      expected_direction: null,
      expected_sources: ['a.md', 'b.md'],
    });
  });

  it('refuses a baseline whose per_case rows are missing one label key', () => {
    // A baseline predating a label reads `undefined !== false` on every case and
    // reports the entire golden set as relabelled, which buries the one line
    // that is real. Requiring each key turns that into one honest sentence.
    // Derived from `describeCaseLabels`, so the NEXT label added cannot silently
    // ungate its own comparison against every baseline written before it.
    const usable = readJson('eval-baseline.json');
    const stripped = {
      ...usable,
      per_case: Object.fromEntries(
        Object.entries(usable.per_case as Record<string, Record<string, unknown>>).map(
          ([id, row]) => {
            const labels = { ...(row.labels as Record<string, unknown>) };
            delete labels.expected_premise_rejection;
            return [id, { ...row, labels }];
          },
        ),
      ),
    };
    const reason = describeUnusableBaseline(stripped);
    expect(reason).toMatch(/per_case field\(s\) missing or mistyped/);
    expect(reason).toContain('.labels.expected_premise_rejection');
  });

  it('refuses a baseline whose per_case rows carry no labels', () => {
    // Otherwise the comparison has no left-hand side and skips silently, which
    // is the defect this file spends most of its length closing.
    const usable = readJson('eval-baseline.json');
    const stripped = {
      ...usable,
      per_case: Object.fromEntries(
        Object.entries(usable.per_case as Record<string, Record<string, unknown>>).map(
          ([id, row]) => {
            const withoutLabels = { ...row };
            delete withoutLabels.labels;
            return [id, withoutLabels];
          },
        ),
      ),
    };
    // The message is now the unified per-case field check, and it still names
    // the labels field specifically, so the test keeps pinning the same fact.
    const reason = describeUnusableBaseline(stripped);
    expect(reason).toMatch(/per_case field\(s\) missing or mistyped/);
    expect(reason).toContain('.labels');
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

  it('accumulates the usage of every replayed response, embeddings included', async () => {
    // `embedQuery` discards the embeddings response's usage, so the tape is the
    // only place an embedding call is still countable. A cost figure read
    // anywhere downstream of it is the completion half of the bill.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rag-eval-tape-usage-'));
    const write = (kind: string, url: string, body: unknown, response: unknown) => {
      const key = requestKey({ method: 'POST', url, body: JSON.stringify(body) });
      writeFileSync(
        path.join(dir, `${kind}.json`),
        JSON.stringify({ version: 1, entries: { [key]: { status: 200, response } } }),
      );
    };
    const embedRequest = { input: 'front pushes mid-corner', model: 'text-embedding-3-small' };
    const chatRequest = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] };
    write('embeddings', 'https://api.openai.com/v1/embeddings', embedRequest, {
      model: 'text-embedding-3-small',
      data: [{ embedding: [0, 1] }],
      usage: { prompt_tokens: 35, total_tokens: 35 },
    });
    write('completions', 'https://api.openai.com/v1/chat/completions', chatRequest, {
      model: 'gpt-4o-mini-2024-07-18',
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 2468, completion_tokens: 334, total_tokens: 2802 },
    });

    const tape = new OpenAiTape({ dir, mode: 'offline' });
    try {
      await tape.load();
      const restore = tape.install();
      try {
        await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          body: JSON.stringify(embedRequest),
        });
        await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify(chatRequest),
        });
      } finally {
        restore();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(tape.stats.hits).toBe(2);
    expect(aggregateUsage(tape.usage)).toEqual([
      {
        model: 'gpt-4o-mini-2024-07-18',
        calls: 1,
        measured_calls: 1,
        prompt_tokens: 2468,
        completion_tokens: 334,
      },
      {
        model: 'text-embedding-3-small',
        calls: 1,
        measured_calls: 1,
        prompt_tokens: 35,
        completion_tokens: 0,
      },
    ]);
    expect(tape.spent).toEqual([]);
  });

  it('charges a live run only for the requests that reached the network', async () => {
    // A `--live` run replays every key a prompt change did not move, so a
    // replayed response is part of the re-record figure and never of what
    // the run spent. A failed live request is spent and unmeasured: the SDK
    // retries 429 and 5xx, and dropping those under-counts the calls made.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rag-eval-tape-spent-'));
    const url = 'https://api.openai.com/v1/chat/completions';
    const replayed = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'replayed' }] };
    const recorded = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'recorded' }] };
    const throttled = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'throttled' }] };
    const replayedKey = requestKey({ method: 'POST', url, body: JSON.stringify(replayed) });
    writeFileSync(
      path.join(dir, 'completions.json'),
      JSON.stringify({
        version: 1,
        entries: {
          [replayedKey]: {
            status: 200,
            response: { model: 'gpt-4o-mini-2024-07-18', usage: { prompt_tokens: 900, completion_tokens: 90 } },
          },
        },
      }),
    );
    const network: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const content = JSON.parse(String(init?.body)).messages[0].content;
      network.push(content);
      if (content === 'throttled') {
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), { status: 429 });
      }
      return new Response(
        JSON.stringify({ model: 'gpt-4o-mini-2024-07-18', usage: { prompt_tokens: 100, completion_tokens: 10 } }),
        { status: 200 },
      );
    }) as typeof fetch;

    const tape = new OpenAiTape({ dir, mode: 'live' });
    try {
      await tape.load();
      const restore = tape.install();
      try {
        for (const body of [replayed, recorded, throttled]) {
          await fetch(url, { method: 'POST', body: JSON.stringify(body) });
        }
      } finally {
        restore();
      }
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }

    expect(network).toEqual(['recorded', 'throttled']);
    expect(aggregateUsage(tape.usage)).toEqual([
      {
        model: 'gpt-4o-mini-2024-07-18',
        calls: 2,
        measured_calls: 2,
        prompt_tokens: 1000,
        completion_tokens: 100,
      },
    ]);
    expect(aggregateUsage(tape.spent)).toEqual([
      { model: 'gpt-4o-mini', calls: 1, measured_calls: 0, prompt_tokens: null, completion_tokens: null },
      {
        model: 'gpt-4o-mini-2024-07-18',
        calls: 1,
        measured_calls: 1,
        prompt_tokens: 100,
        completion_tokens: 10,
      },
    ]);
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

/**
 * Every other script that needs the key reads the settings files through
 * `loadEnvFiles` (`scripts/lib/env.mjs`), and the eval did not, so `--live`
 * failed unless the key had been exported in the shell by hand. Each case here
 * points the loader at a directory of its own, so the repository's real
 * settings files are never read.
 */
describe('where the eval finds its OpenAI key', () => {
  const exported = process.env.OPENAI_API_KEY;
  let settingsDir: string;

  beforeEach(() => {
    settingsDir = mkdtempSync(path.join(os.tmpdir(), 'rag-eval-settings-'));
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    rmSync(settingsDir, { recursive: true, force: true });
    if (exported === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = exported;
  });

  it('reads the key for --live from a settings file when the shell has none', () => {
    writeFileSync(path.join(settingsDir, '.env'), 'OPENAI_API_KEY=sk-from-settings-file\n');

    expect(prepareOpenAiApiKey({ live: true, root: settingsDir })).toBeNull();
    expect(process.env.OPENAI_API_KEY).toBe('sk-from-settings-file');
  });

  it('keeps a key exported in the shell over the one in a settings file', () => {
    process.env.OPENAI_API_KEY = 'sk-from-shell';
    writeFileSync(path.join(settingsDir, '.env.local'), 'OPENAI_API_KEY=sk-from-settings-file\n');

    expect(prepareOpenAiApiKey({ live: true, root: settingsDir })).toBeNull();
    expect(process.env.OPENAI_API_KEY).toBe('sk-from-shell');
  });

  it('still replays offline on the placeholder when there is no key anywhere', () => {
    expect(prepareOpenAiApiKey({ live: false, root: settingsDir })).toBeNull();
    expect(process.env.OPENAI_API_KEY).toBe('sk-offline-replay-placeholder');
  });

  it('refuses --live with no key anywhere, and names the settings files it read', () => {
    const problem = prepareOpenAiApiKey({ live: true, root: settingsDir });

    expect(problem).toContain('.env.local');
    expect(problem).toMatch(/\.env(?!\.)/);
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });
});

/**
 * The grounding measurement. It gates nothing, which is exactly why it is worth
 * testing: a reported figure nobody compares against a baseline is one nobody
 * would notice going wrong, and this one exists to inform a spending decision
 * about the knowledge base.
 */
describe('grounding measurement', () => {
  const excerptAt = (limit: number) => (text: string) => text.slice(0, limit);
  const whole = (text: string) => text;

  it('counts an empty chunk as no words rather than one', () => {
    // `''.split(/\s+/)` is `['']`, so the naive count inflates every figure
    // below by one word per empty or whitespace-only chunk.
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
    expect(countWords(' one  two \n three ')).toBe(3);
  });

  it('measures the excerpt the prompt prints, not the whole chunk', () => {
    const retrieved = [{ chunk: { source: 'a.md', text: 'one two three four five' } }];

    expect(summarizeContext(retrieved, whole)).toEqual({ chunks: 1, words: 5, sources: 1 });
    // A chunk the prompt truncates contributes only what survived truncation,
    // so raising EXCERPT_MAX_CHARS shows up here as more grounding rather than
    // leaving the figure pinned to the index.
    expect(summarizeContext(retrieved, excerptAt(7))).toEqual({ chunks: 1, words: 2, sources: 1 });
  });

  it('counts distinct sources, so four chunks of one file are one document', () => {
    const retrieved = [
      { chunk: { source: 'a.md', text: 'x' } },
      { chunk: { source: 'a.md', text: 'x' } },
      { chunk: { source: 'b.md', text: 'x' } },
    ];

    expect(summarizeContext(retrieved, whole)).toEqual({ chunks: 3, words: 3, sources: 2 });
  });

  it('reports null for a case the retriever never ran for', () => {
    // A classifier refusal returns before `generateTuningAdvice`. Zero words
    // would say the model was handed nothing; it was never asked.
    expect(summarizeContext(null, whole)).toBeNull();
  });

  it('reports null rather than zero when no case retrieved at all', () => {
    // The empty-collection rule this harness is built on. `0 words` would read
    // as the most alarming possible result of a measurement that never ran.
    expect(aggregateContext([{ id: 'refused', contextDepth: null }])).toEqual({
      cases: 0,
      words: null,
      chunks: null,
      sources: null,
      thinnest: null,
    });
  });

  it('averages over the cases that retrieved and names the thinnest answer', () => {
    const agg = aggregateContext([
      { id: 'wide', contextDepth: { chunks: 4, words: 300, sources: 3 } },
      { id: 'thin', contextDepth: { chunks: 2, words: 100, sources: 1 } },
      { id: 'refused', contextDepth: null },
    ]);

    expect(agg.cases).toBe(2);
    expect(agg.words).toBe(200);
    expect(agg.chunks).toBe(3);
    expect(agg.sources).toBe(2);
    expect(agg.thinnest).toEqual({ id: 'thin', words: 100 });
  });

  it('describes the index the answers were drawn from, and an empty one as unmeasured', () => {
    const corpus = describeCorpus([
      { source: 'a.md', text: 'one two three four' },
      { source: 'a.md', text: 'one two' },
    ]);

    expect(corpus).toEqual({ chunks: 2, sources: 1, words: 6, words_per_chunk: 3 });
    expect(describeCorpus([])).toEqual({ chunks: 0, sources: 0, words: 0, words_per_chunk: null });
  });

  it('counts a missed source against the cases that labelled it, not the whole set', () => {
    const tally = tallyMissedSources([
      {
        retrieval: { applicable: true, missed: ['deep.md'] },
        labels: { expected_sources: ['deep.md', 'found.md'] },
      },
      {
        retrieval: { applicable: true, missed: ['deep.md'] },
        labels: { expected_sources: ['deep.md'] },
      },
      // Unlabelled and unscoreable cases are not chances the source was given.
      { retrieval: { applicable: false, missed: [] }, labels: { expected_sources: [] } },
    ]);

    expect(tally).toEqual([{ source: 'deep.md', misses: 2, labelled: 2 }]);
  });

  it('totals token spend per model over both endpoints', () => {
    // An embeddings response carries prompt_tokens and total_tokens and no
    // completion_tokens. That is zero completion, not an unmeasured one.
    expect(
      aggregateUsage([
        { model: 'gpt-4o-mini-2024-07-18', usage: { prompt_tokens: 100, completion_tokens: 20 } },
        { model: 'gpt-4o-mini-2024-07-18', usage: { prompt_tokens: 50, completion_tokens: 10 } },
        { model: 'text-embedding-3-small', usage: { prompt_tokens: 35, total_tokens: 35 } },
      ]),
    ).toEqual([
      {
        model: 'gpt-4o-mini-2024-07-18',
        calls: 2,
        measured_calls: 2,
        prompt_tokens: 150,
        completion_tokens: 30,
      },
      {
        model: 'text-embedding-3-small',
        calls: 1,
        measured_calls: 1,
        prompt_tokens: 35,
        completion_tokens: 0,
      },
    ]);
  });

  it('counts a response that reported no usage as unmeasured, not as zero tokens', () => {
    expect(
      aggregateUsage([
        { model: 'gpt-4o-mini', usage: { prompt_tokens: 100, completion_tokens: 20 } },
        { model: 'gpt-4o-mini', usage: undefined },
      ]),
    ).toEqual([
      {
        model: 'gpt-4o-mini',
        calls: 2,
        measured_calls: 1,
        prompt_tokens: 100,
        completion_tokens: 20,
      },
    ]);
  });

  it('reports null totals rather than zero when no call reported usage at all', () => {
    // Summing an absent usage object as 0 prints a confidently wrong cost with
    // no signal it was never measured - which is what a provider that stops
    // filling the field would produce, on exactly the model change ahead.
    expect(aggregateUsage([{ model: 'next-model', usage: null }])).toEqual([
      {
        model: 'next-model',
        calls: 1,
        measured_calls: 0,
        prompt_tokens: null,
        completion_tokens: null,
      },
    ]);
  });
});
