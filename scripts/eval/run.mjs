/**
 * The eval harness proper. Everything here runs against the modules the route
 * handler runs against - `scripts/eval/ts-loader.mjs` resolves them - so a case
 * exercises the real classifier, the real embedding, the real retriever, the
 * real prompt builder, the real schema parser and the real policy. The only
 * substitution is the network, and that is `scripts/eval/openai-tape.mjs`.
 *
 * WHAT THIS REPLACED. The previous harness read eleven hand-written
 * `AdviceResponse` objects and applied four boolean predicates to them. It
 * imported nothing from `lib/rag/`, so it could not measure retrieval relevance
 * (it never retrieved) or answer quality (it never generated an answer), and it
 * had reported 100% since the day it was written because its inputs were
 * constants. A 2026-08-21 audit fed it three responses production force-refuses
 * - 50 psi into a front tire, removing a front brake, a citation to a
 * knowledge-base file that has never existed - and all three scored 4/4 PASS.
 * Those three are now `tests/fixtures/rag-eval/adversarial-responses.json` and
 * every run scores them as a self-check, so a run that reports a pass rate has
 * also just demonstrated it can report a failure.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { OpenAiTape } from './openai-tape.mjs';
import {
  matchesExpectedComponent,
  matchesExpectedDirection,
  scoreAdviceResponse,
} from './scoring.mjs';
import { aggregateRetrieval, scoreRetrieval } from './retrieval.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const GOLDEN_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'rag-eval', 'golden-cases.json');
const ADVERSARIAL_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'rag-eval', 'adversarial-responses.json');
const RECORDINGS_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'rag-eval', 'recordings');
const BASELINE_PATH = path.join(REPO_ROOT, 'eval-baseline.json');
const INDEX_PATH = path.join(REPO_ROOT, 'data', 'rag-index.json');

/**
 * The exit criterion `docs/ai-mvp-spec.md` sets. It is PRINTED, not gated: with
 * 32 cases one case is 3.1%, and a hard floor on an absolute rate turns any
 * honest golden case the model gets wrong into permanently red CI. What gates
 * is the baseline comparison below, which is also the thing the resume claim is
 * actually about - comparing prompt and retrieval changes before shipping them.
 */
const RUBRIC_TARGET = 0.85;

/**
 * What the committed numbers do NOT cover, emitted INTO `eval-baseline.json` by
 * the writer below rather than hand-added to it. A caveat typed into that file
 * survives exactly until the next `--update-baseline` overwrites it, and a
 * limitation that disappears the moment somebody re-baselines is worse than one
 * nobody wrote down: the reader after that has no way to know it ever existed.
 */
const BASELINE_LIMITATIONS = [
  {
    id: 'harness-context-weather-flag',
    what:
      'buildContext reports data_used.weather as `temperature_c != null` while supplying ' +
      'no session_environment row. Production cannot produce that pair: ' +
      'loadRaceEngineerContext sets `weather: Boolean(sessionEnvironment)`, so with no row ' +
      'it prints weather=false. Every recorded prompt for a golden case carrying ' +
      'temperature_c is therefore one boolean away from what the route would have sent.',
    retrieval_unaffected:
      'recall_at_k and MRR stand unconditionally. The query text embedQuery sees does not ' +
      'carry data_used, so retrieval ran on exactly the input production would have ' +
      'embedded and these two are production-faithful.',
    answer_quality_qualified:
      'rubric_pass_rate, refusal_accuracy, component_accuracy and direction_accuracy were ' +
      'produced under that prompt. They remain VALID for regression detection, because both ' +
      'sides of any future comparison are built by this same code - they simply do not state ' +
      'what production answer quality is.',
    closed_by:
      'the next `npm run rag:eval -- --live` re-record, once an API key exists. Correcting ' +
      'the flag moves every completion tape key, so it cannot be done without one.',
  },
];

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

/** A `sessions` row shaped like the database returns one. */
function buildSession(caseInput, ids) {
  const s = caseInput.session;
  return {
    id: ids.sessionId,
    user_id: ids.userId,
    vehicle_id: ids.vehicleId,
    track_id: null,
    track_name: s.track_name ?? null,
    date: s.date,
    start_time: s.start_time ?? null,
    session_number: s.session_number ?? null,
    conditions: s.conditions,
    tires: s.tires,
    suspension: s.suspension,
    alignment: s.alignment ?? null,
    enabled_modules: s.enabled_modules ?? null,
    extra_modules: s.extra_modules ?? null,
    notes: s.notes ?? null,
    created_at: `${s.date}T12:00:00.000Z`,
    updated_at: `${s.date}T12:00:00.000Z`,
  };
}

function buildVehicle(caseInput, ids) {
  const v = caseInput.vehicle;
  return {
    id: ids.vehicleId,
    user_id: ids.userId,
    nickname: v.nickname,
    type: v.type,
    year: v.year ?? null,
    make: v.make ?? null,
    model: v.model ?? null,
    photo_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * The context `loadRaceEngineerContext` would build for a rider with one logged
 * session and no history: no similar sessions, no environment row, no feedback,
 * no stored recommendations. `dayTrend` comes from the real `buildDayTrend`
 * rather than a string written here, so the prompt reads exactly as production
 * would render it for that rider.
 *
 * Golden cases carry no history on purpose. Similar sessions, feedback and
 * stored recommendations are Supabase reads, and a harness that stood a fake
 * database up to supply them would be measuring the fake. What history changes
 * on this path is which optional blocks the prompt prints; what it does not
 * change is the pipeline under test.
 *
 * ONE FIELD HERE IS NOT FAITHFUL, AND IT SHIPS THAT WAY DELIBERATELY.
 * `dataUsed.weather` is `temperatureC != null` beside `sessionEnvironment: null`,
 * and production cannot produce that pair - `loadRaceEngineerContext` sets
 * `weather: Boolean(sessionEnvironment)`, so with no environment row the route
 * prints `weather=false` into the same `data_used` line
 * (`formatRaceEngineerContext`). Scoring is unaffected either way, because the
 * policy fallback the route uses is `temperature_c != null || dataUsed.weather`
 * and `runCase` mirrors it. Retrieval is unaffected too: the query text
 * `embedQuery` sees carries no `data_used`, so recall and MRR are
 * production-faithful. What it does touch is the recorded PROMPT, and therefore
 * the answer-quality numbers - which stay valid for regression detection, since
 * both sides of any comparison are built here, without stating what production
 * quality is. It is not corrected because the correction moves every completion
 * tape key and re-recording needs an API key that has been revoked. The next
 * `--live` re-record closes it. `BASELINE_LIMITATIONS` above is the same note,
 * emitted into the baseline so it reaches whoever reads the numbers.
 */
function buildContext({ session, temperatureC, buildDayTrend }) {
  return {
    similarSessions: [],
    sessionEnvironment: null,
    recentFeedback: [],
    recentRecommendations: [],
    memory: null,
    telemetrySummary: null,
    dayTrend: buildDayTrend(session, null, []),
    dataUsed: {
      manual: true,
      weather: temperatureC != null,
      history: false,
      feedback: false,
      lap_data: false,
      telemetry: false,
    },
  };
}

/**
 * One golden case through the pipeline, in the order
 * `app/api/ai/tuning-advice/route.ts` runs it: submitted-text classifier, then
 * stored-text screen over what the prompt will interpolate, then the model, then
 * the policy. Skipping a stage here would mean the harness scored a path no
 * rider can take.
 */
async function runCase(testCase, deps) {
  const {
    classifyRaceEngineerQuestion,
    classifyStoredRiderText,
    buildRefusalAdvice,
    collectTuningAdviceRiderText,
    dropScreenedSources,
    generateTuningAdvice,
    buildDayTrend,
  } = deps;

  const ids = {
    userId: '00000000-0000-4000-8000-000000000001',
    vehicleId: '00000000-0000-4000-8000-000000000002',
    sessionId: `00000000-0000-4000-8000-${String(testCase.index + 1).padStart(12, '0')}`,
  };
  const session = buildSession(testCase.input, ids);
  const vehicle = buildVehicle(testCase.input, ids);
  const temperatureC = testCase.input.temperature_c ?? undefined;
  const symptoms = testCase.input.symptoms ?? [];
  const changeIntent = testCase.input.change_intent ?? undefined;

  const fallbackDataUsed = {
    manual: true,
    weather: temperatureC != null,
    history: false,
    feedback: false,
    lap_data: false,
    telemetry: false,
  };

  const questionAssessment = classifyRaceEngineerQuestion({
    question: testCase.input.question,
    symptoms,
    changeIntent,
  });

  if (questionAssessment.decision === 'refuse') {
    return {
      stage: `classifier:${questionAssessment.reason}`,
      response: buildRefusalAdvice({
        reason: questionAssessment.reason ?? 'out_of_domain',
        message: questionAssessment.message ?? 'This request is outside trackday setup scope.',
        dataUsed: fallbackDataUsed,
      }),
      retrievedSources: null,
      fallbackDataUsed,
      validSessionIds: [session.id],
    };
  }

  const context = buildContext({ session, temperatureC, buildDayTrend });

  const storedAssessment = classifyStoredRiderText({
    unableMessage: 'I could not answer that from your saved setup data.',
    fields: collectTuningAdviceRiderText({
      session,
      previousSession: null,
      vehicle,
      question: testCase.input.question,
      symptoms,
      changeIntent,
      temperatureC,
      raceEngineerContext: context,
    }),
  });

  if (storedAssessment.decision === 'refuse') {
    return {
      stage: 'classifier:stored_rider_text',
      response: buildRefusalAdvice({
        reason: 'prompt_injection',
        message:
          storedAssessment.message ??
          'I could not answer that from your saved setup data.',
        dataUsed: fallbackDataUsed,
      }),
      retrievedSources: null,
      fallbackDataUsed,
      validSessionIds: [session.id],
    };
  }

  const screened = dropScreenedSources(context, storedAssessment.droppedSources, session);

  const result = await generateTuningAdvice({
    session,
    previousSession: null,
    vehicle,
    question: testCase.input.question,
    symptoms,
    changeIntent,
    temperatureC,
    raceEngineerContext: screened,
  });

  return {
    stage: 'model',
    response: result.advice,
    retrievedSources: result.retrieved.map(({ chunk }) => chunk.source),
    usage: result.usage,
    latencyMs: result.latencyMs,
    model: result.model,
    fallbackDataUsed: {
      ...screened.dataUsed,
      weather: temperatureC != null || screened.dataUsed.weather,
    },
    validSessionIds: [session.id],
  };
}

function ratio(hits, total) {
  return total === 0 ? null : hits / total;
}

function fmt(value) {
  return value == null ? '  n/a' : value.toFixed(2);
}

function diffLine(label, current, previous) {
  if (previous == null || current == null) {
    return `  ${label.padEnd(20)} ${fmt(current)}   (no baseline)`;
  }
  const delta = current - previous;
  const sign = delta >= 0 ? '+' : '-';
  return `  ${label.padEnd(20)} ${previous.toFixed(2)} -> ${current.toFixed(2)} (${sign}${Math.abs(delta).toFixed(2)})`;
}

export async function main(argv) {
  const args = new Set(argv);
  const live = args.has('--live');
  const updateBaseline = args.has('--update-baseline');
  const mode = live ? 'live' : 'offline';

  if (!live && !process.env.OPENAI_API_KEY) {
    // Offline replays committed tapes and never opens a socket, but the client
    // is still constructed for real and `getOpenAIApiKey()` throws on an empty
    // one. This is what lets CI run the whole pipeline with no secret.
    process.env.OPENAI_API_KEY = 'sk-offline-replay-placeholder';
  }
  if (live && !process.env.OPENAI_API_KEY) {
    console.error('[rag:eval] --live needs OPENAI_API_KEY in the environment.');
    return 1;
  }

  const [golden, adversarial, index] = await Promise.all([
    readJson(GOLDEN_PATH),
    readJson(ADVERSARIAL_PATH),
    readJson(INDEX_PATH),
  ]);
  const knowledgeBaseSources = new Set(index.chunks.map((c) => c.source));

  const [policyModule, guardModule, promptModule, adviceModule, contextModule, vocabulary] =
    await Promise.all([
      import('@/lib/rag/policy'),
      import('@/lib/rag/domain-guard'),
      import('@/lib/rag/prompt'),
      import('@/lib/rag/advice'),
      import('@/lib/rag/race-engineer-context'),
      import('@/lib/rag/component-vocabulary'),
    ]);
  const { evaluateAdvicePolicy } = policyModule;

  // ------------------------------------------------------------------
  // Self-check. Runs before anything that can cost money, needs no key in
  // either mode, and gates the whole run: a harness that cannot fail these
  // three cannot be trusted about the thirty-two below it.
  // ------------------------------------------------------------------
  const selfCheck = adversarial.cases.map((c) => {
    const scored = scoreAdviceResponse({
      response: c.response,
      knowledgeBaseSources,
      evaluateAdvicePolicy,
      fallbackDataUsed: c.response.data_used,
      validSessionIds: [],
      shouldRefuse: false,
    });
    return { id: c.id, expected: c.expected_failure, ...scored };
  });

  console.log('\n[rag:eval] Scorer self-check - responses production force-refuses\n');
  for (const entry of selfCheck) {
    console.log(
      `  ${entry.id.padEnd(34)} ${entry.passed ? 'PASSED (BUG)' : 'rejected'}  ${entry.failures[0] ?? ''}`,
    );
  }
  const selfCheckBroken = selfCheck.filter((entry) => entry.passed);

  const tape = new OpenAiTape({ dir: RECORDINGS_DIR, mode });
  await tape.load();
  const restoreFetch = tape.install();

  const results = [];
  try {
    for (const [indexInCase, testCase] of golden.cases.entries()) {
      let outcome;
      try {
        outcome = await runCase({ ...testCase, index: indexInCase }, {
          ...guardModule,
          ...promptModule,
          ...adviceModule,
          buildDayTrend: contextModule.buildDayTrend,
        });
      } catch (err) {
        results.push({
          id: testCase.id,
          tags: testCase.tags ?? [],
          error: err?.message ?? String(err),
          scored: null,
          retrieval: {
            applicable: false,
            recall: null,
            reciprocalRank: null,
            hits: [],
            missed: [],
            retrieved: null,
          },
        });
        continue;
      }

      const scored = scoreAdviceResponse({
        response: outcome.response,
        knowledgeBaseSources,
        evaluateAdvicePolicy,
        fallbackDataUsed: outcome.fallbackDataUsed,
        validSessionIds: outcome.validSessionIds,
        shouldRefuse: testCase.should_refuse === true,
      });

      const retrieval = scoreRetrieval(outcome.retrievedSources, testCase.expected_sources ?? []);
      // Whether the MODEL reached the human's answer is only a question about a
      // case the model was asked. A classifier refusal returns before
      // `generateTuningAdvice`, so there is no answer to compare and the case is
      // not applicable - the same distinction `scoreRetrieval` draws one line
      // above. A model that WAS asked and recommended nothing is a miss, not a
      // skip.
      const modelAnswered = outcome.stage === 'model';
      const primary = outcome.response.recommended_changes?.[0] ?? null;

      results.push({
        id: testCase.id,
        tags: testCase.tags ?? [],
        stage: outcome.stage,
        model: outcome.model ?? null,
        error: null,
        scored,
        retrieval,
        confidence: outcome.response.confidence,
        componentMatch: modelAnswered
          ? matchesExpectedComponent(primary?.component, testCase.expected_component, vocabulary)
          : null,
        directionMatch: modelAnswered
          ? matchesExpectedDirection(
              primary?.direction,
              testCase.expected_direction,
              testCase.expected_component ?? primary?.component,
              vocabulary,
            )
          : null,
        refusalMatch: (testCase.should_refuse === true) === scored.refused,
      });
    }
  } finally {
    restoreFetch();
    if (live) await tape.save();
  }

  return report({
    results,
    selfCheck,
    selfCheckBroken,
    tape,
    mode,
    live,
    updateBaseline,
    index,
  });
}

async function report(ctx) {
  const { results, selfCheckBroken, tape, mode, live, updateBaseline } = ctx;

  const ID_WIDTH = Math.max(20, ...results.map((r) => r.id.length));

  const scoredResults = results.filter((r) => !r.error);
  const retrievalAgg = aggregateRetrieval(scoredResults.map((r) => r.retrieval));
  const componentCases = scoredResults.filter((r) => r.componentMatch !== null);
  const directionCases = scoredResults.filter((r) => r.directionMatch !== null);
  const metrics = {
    rubric_pass_rate: ratio(scoredResults.filter((r) => r.scored.passed).length, scoredResults.length),
    recall_at_k: retrievalAgg.recall,
    mrr: retrievalAgg.mrr,
    refusal_accuracy: ratio(scoredResults.filter((r) => r.refusalMatch).length, scoredResults.length),
    component_accuracy: ratio(
      componentCases.filter((r) => r.componentMatch === true).length,
      componentCases.length,
    ),
    direction_accuracy: ratio(
      directionCases.filter((r) => r.directionMatch === true).length,
      directionCases.length,
    ),
  };
  /**
   * How much was measured, beside what was measured. EVERY rate above has a
   * variable denominator, including the two whose denominator is the whole
   * golden set: a case leaves the retrieval average when a classifier refuses
   * it before anything is embedded, leaves the accuracy averages when the model
   * is never asked, and leaves `scored_cases` when it is deleted from
   * `golden-cases.json` outright. So a rate can rise because coverage fell
   * rather than because anything improved - deleting one failing case lifts the
   * rubric pass rate from 27/32 to 27/31 while no metric regresses.
   * `retrieval_k` is the same property for the metric's shape rather than its
   * population. All of it goes into the baseline, because a gated number whose
   * denominator is not recorded cannot be compared against later.
   */
  const coverage = {
    scored_cases: scoredResults.length,
    retrieval_k: retrievalAgg.k,
    retrieval_cases: retrievalAgg.cases,
    component_cases: componentCases.length,
    direction_cases: directionCases.length,
  };
  const kLabel = coverage.retrieval_k ?? 'k';

  console.log(`\n[rag:eval] ${results.length} golden cases, ${mode} mode\n`);
  const header = `${'id'.padEnd(ID_WIDTH)} act safe gnd trn pol  rec@${kLabel}  rr   conf    result`;
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of results) {
    if (r.error) {
      console.log(`${r.id.padEnd(ID_WIDTH)} ${'ERROR'.padEnd(28)} ${r.error.split('\n')[0].slice(0, 72)}`);
      continue;
    }
    const cell = (ok) => (ok ? ' ok ' : 'FAIL');
    const c = r.scored.categories;
    const policyOk = !r.scored.failures.some((f) => f.startsWith('policy:'));
    console.log(
      `${r.id.padEnd(ID_WIDTH)} ${cell(c.actionability.ok)} ${cell(c.safety.ok)} ${cell(c.grounding.ok)} ` +
        `${cell(c.transparency.ok)} ${cell(policyOk)} ${fmt(r.retrieval.recall)}  ${fmt(r.retrieval.reciprocalRank)} ` +
        `${(r.confidence ?? '-').padEnd(7)} ${r.scored.passed ? 'PASS' : 'FAIL'}`,
    );
    if (!r.scored.passed) {
      for (const failure of r.scored.failures) console.log(`${' '.repeat(ID_WIDTH + 2)}- ${failure}`);
    }
    if (r.retrieval.applicable && r.retrieval.missed.length > 0) {
      console.log(`${' '.repeat(ID_WIDTH + 2)}- retrieval missed: ${r.retrieval.missed.join(', ')}`);
    }
  }
  console.log('-'.repeat(header.length));

  console.log('\nAggregate');
  console.log(`  rubric pass rate     ${fmt(metrics.rubric_pass_rate)}  (spec target ${RUBRIC_TARGET.toFixed(2)}, reported not gated)`);
  console.log(`  recall@${kLabel}             ${fmt(metrics.recall_at_k)}  over ${coverage.retrieval_cases} labelled cases`);
  console.log(`  MRR                  ${fmt(metrics.mrr)}`);
  console.log(`  refusal accuracy     ${fmt(metrics.refusal_accuracy)}`);
  console.log(`  component accuracy   ${fmt(metrics.component_accuracy)}  over ${coverage.component_cases} answered cases`);
  console.log(`  direction accuracy   ${fmt(metrics.direction_accuracy)}  over ${coverage.direction_cases} answered cases`);

  let baseline = null;
  try {
    baseline = await readJson(BASELINE_PATH);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }

  console.log('\nAgainst baseline');
  const regressions = [];
  // `component accuracy` and `direction accuracy` are REPORTED AND NEVER GATED.
  // They ask whether the model reached the human's answer, which is a property
  // of the model's wording rather than of anything this repository changed, so
  // one case wobbling across a re-record would turn CI red on sampling noise -
  // the same variance for which gating `--live` was rejected below. They are
  // still diffed here and still written to the baseline.
  const previousCoverage = baseline?.coverage ?? null;
  for (const [key, label, gated, coverageKey] of [
    ['rubric_pass_rate', 'rubric pass rate', true, 'scored_cases'],
    ['recall_at_k', `recall@${kLabel}`, true, 'retrieval_cases'],
    ['mrr', 'MRR', true, 'retrieval_cases'],
    ['refusal_accuracy', 'refusal accuracy', true, 'scored_cases'],
    ['component_accuracy', 'component accuracy', false, 'component_cases'],
    ['direction_accuracy', 'direction accuracy', false, 'direction_cases'],
  ]) {
    const previous = baseline?.metrics?.[key] ?? null;
    const count = coverageKey == null ? null : coverage[coverageKey];
    const previousCount = coverageKey == null ? null : (previousCoverage?.[coverageKey] ?? null);
    const over =
      count == null
        ? ''
        : previousCount == null || previousCount === count
          ? `  over ${count} cases`
          : `  over ${count} cases, was ${previousCount}`;
    console.log(`${diffLine(label, metrics[key], previous)}${over}${gated ? '' : '  reported, not gated'}`);
    if (gated && previous != null && metrics[key] != null && metrics[key] < previous - 1e-9) {
      regressions.push(`${label} ${previous.toFixed(2)} -> ${metrics[key].toFixed(2)}`);
    }
  }

  // A rate can rise because its denominator fell. `recall@k` and MRR are gated,
  // so a case leaving their average - a classifier refusing a labelled case
  // before anything is embedded, say - can raise both while nothing about
  // retrieval improved, and the rate alone cannot say so. A changed k is worse
  // than that: the metric is no longer the same measurement, so comparing it to
  // the stored one is meaningless rather than merely flattering.
  if (previousCoverage?.scored_cases != null && coverage.scored_cases < previousCoverage.scored_cases) {
    regressions.push(
      `scored coverage ${previousCoverage.scored_cases} -> ${coverage.scored_cases} cases ` +
        '(a rise in the rubric pass rate or refusal accuracy may be a case that left the set rather than one that started passing)',
    );
  }
  if (previousCoverage?.retrieval_cases != null && coverage.retrieval_cases < previousCoverage.retrieval_cases) {
    regressions.push(
      `retrieval coverage ${previousCoverage.retrieval_cases} -> ${coverage.retrieval_cases} labelled cases ` +
        `(a rise in recall@${kLabel} or MRR may be the smaller denominator rather than better retrieval)`,
    );
  }
  if (
    previousCoverage?.retrieval_k != null &&
    coverage.retrieval_k != null &&
    coverage.retrieval_k !== previousCoverage.retrieval_k
  ) {
    regressions.push(
      `retrieval k ${previousCoverage.retrieval_k} -> ${coverage.retrieval_k}, so recall is not the metric the baseline recorded`,
    );
  }
  if (baseline) {
    const nowFailing = scoredResults
      .filter((r) => !r.scored.passed && baseline.per_case?.[r.id]?.passed === true)
      .map((r) => r.id);
    if (nowFailing.length > 0) {
      console.log(`  cases newly failing: ${nowFailing.join(', ')}`);
    }
  }

  const errors = results.filter((r) => r.error);
  const unsound = [];
  if (selfCheckBroken.length > 0) {
    unsound.push(`the scorer passed ${selfCheckBroken.length} response(s) production force-refuses`);
  }
  if (tape.stats.misses.length > 0) {
    unsound.push(`${tape.stats.misses.length} request(s) had no recording`);
  }
  if (errors.length > 0) {
    unsound.push(`${errors.length} case(s) threw`);
  }

  if (updateBaseline && unsound.length > 0) {
    console.error(
      `\n[rag:eval] Baseline NOT written: ${unsound.join('; ')}. A baseline is the floor ` +
        'every later run is measured against, so it is only ever written from a run that ' +
        'scored every case. Fix the failures below and re-run.',
    );
  } else if (updateBaseline) {
    const doc = {
      version: 1,
      recorded_at: new Date().toISOString(),
      mode,
      model: results.find((r) => r.model)?.model ?? null,
      embedding_model: ctx.index.model,
      knowledge_index_generated_at: ctx.index.generated_at,
      cases: results.length,
      metrics,
      coverage,
      limitations: BASELINE_LIMITATIONS,
      per_case: Object.fromEntries(
        scoredResults.map((r) => [
          r.id,
          {
            passed: r.scored.passed,
            recall: r.retrieval.recall,
            reciprocal_rank: r.retrieval.reciprocalRank,
            policy: r.scored.policy.decision,
          },
        ]),
      ),
    };
    await fs.writeFile(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    console.log(`\n[rag:eval] Baseline written to ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
  }

  console.log(
    `\n[rag:eval] tape: ${tape.stats.hits} replayed, ${tape.stats.recorded} recorded, ${tape.stats.misses.length} missed`,
  );

  let exitCode = 0;

  if (selfCheckBroken.length > 0) {
    console.error(
      `\n[rag:eval] FAIL: the scorer accepted ${selfCheckBroken.length} response(s) production force-refuses ` +
        `(${selfCheckBroken.map((e) => e.id).join(', ')}). The harness cannot report a failure it does not detect.`,
    );
    exitCode = 1;
  }
  if (tape.stats.misses.length > 0) {
    console.error(`\n[rag:eval] FAIL: ${tape.stats.misses.length} request(s) had no recording:`);
    // Capped: a prompt change misses on every case at once, and 30 lines of
    // hash push the one line that says what to do off the top of a CI log.
    const MISS_PREVIEW = 8;
    for (const miss of tape.stats.misses.slice(0, MISS_PREVIEW)) {
      console.error(`  ${miss.kind} ${miss.key}  ${miss.summary ?? ''}`);
    }
    if (tape.stats.misses.length > MISS_PREVIEW) {
      console.error(`  ... and ${tape.stats.misses.length - MISS_PREVIEW} more`);
    }
    console.error(
      '  Re-record with `OPENAI_API_KEY=... npm run rag:eval -- --live` and commit\n' +
        '  tests/fixtures/rag-eval/recordings/ with the change that moved the prompt.',
    );
    exitCode = 1;
  }
  if (errors.length > 0) {
    console.error(`\n[rag:eval] FAIL: ${errors.length} case(s) threw: ${errors.map((e) => e.id).join(', ')}`);
    exitCode = 1;
  }
  if (regressions.length > 0 && !live && !updateBaseline) {
    // Gated offline only. `--live` calls the API only for requests whose key
    // has no recording - a matching entry is replayed before the mode is
    // consulted - so a live run on an unchanged prompt makes no call at all and
    // is byte-identical to an offline one, while one on a changed prompt
    // re-samples the model for every key that moved. Gating the mixture would
    // fail on sampling variance rather than on a change anyone made. Offline
    // replays fixed recordings and is deterministic, so a regression there is a
    // real consequence of an edit in this repository. The `N replayed, M
    // recorded` line above says which of the two a given live run was.
    console.error('\n[rag:eval] FAIL: gated metrics or their coverage moved against eval-baseline.json:');
    for (const line of regressions) console.error(`  ${line}`);
    console.error(
      '  Investigate, or re-baseline deliberately with `npm run rag:eval -- --update-baseline`.',
    );
    exitCode = 1;
  }

  if (exitCode === 0) console.log('\n[rag:eval] OK');
  return exitCode;
}
