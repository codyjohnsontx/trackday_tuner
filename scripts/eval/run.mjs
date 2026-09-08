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
import { aggregateRetrieval, RETRIEVAL_K, scoreRetrieval } from './retrieval.mjs';

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
          retrieval: { applicable: false, recall: null, reciprocalRank: null, hits: [], missed: [] },
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
        componentMatch: matchesExpectedComponent(
          primary?.component,
          testCase.expected_component,
          vocabulary,
        ),
        directionMatch: matchesExpectedDirection(
          primary?.direction,
          testCase.expected_direction,
          testCase.expected_component ?? primary?.component,
          vocabulary,
        ),
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

  console.log(`\n[rag:eval] ${results.length} golden cases, ${mode} mode\n`);
  const header = `${'id'.padEnd(ID_WIDTH)} act safe gnd trn pol  rec@${RETRIEVAL_K}  rr   conf    result`;
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

  const scoredResults = results.filter((r) => !r.error);
  const retrievalAgg = aggregateRetrieval(scoredResults.map((r) => r.retrieval));
  const metrics = {
    rubric_pass_rate: ratio(scoredResults.filter((r) => r.scored.passed).length, scoredResults.length),
    recall_at_4: retrievalAgg.recall,
    mrr: retrievalAgg.mrr,
    refusal_accuracy: ratio(scoredResults.filter((r) => r.refusalMatch).length, scoredResults.length),
    component_accuracy: ratio(
      scoredResults.filter((r) => r.componentMatch === true).length,
      scoredResults.filter((r) => r.componentMatch !== null).length,
    ),
    direction_accuracy: ratio(
      scoredResults.filter((r) => r.directionMatch === true).length,
      scoredResults.filter((r) => r.directionMatch !== null).length,
    ),
  };

  console.log('\nAggregate');
  console.log(`  rubric pass rate     ${fmt(metrics.rubric_pass_rate)}  (spec target ${RUBRIC_TARGET.toFixed(2)}, reported not gated)`);
  console.log(`  recall@${RETRIEVAL_K}             ${fmt(metrics.recall_at_4)}  over ${retrievalAgg.cases} labelled cases`);
  console.log(`  MRR                  ${fmt(metrics.mrr)}`);
  console.log(`  refusal accuracy     ${fmt(metrics.refusal_accuracy)}`);
  console.log(`  component accuracy   ${fmt(metrics.component_accuracy)}`);
  console.log(`  direction accuracy   ${fmt(metrics.direction_accuracy)}`);

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
  for (const [key, label, gated] of [
    ['rubric_pass_rate', 'rubric pass rate', true],
    ['recall_at_4', `recall@${RETRIEVAL_K}`, true],
    ['mrr', 'MRR', true],
    ['refusal_accuracy', 'refusal accuracy', true],
    ['component_accuracy', 'component accuracy', false],
    ['direction_accuracy', 'direction accuracy', false],
  ]) {
    const previous = baseline?.metrics?.[key] ?? null;
    console.log(`${diffLine(label, metrics[key], previous)}${gated ? '' : '  reported, not gated'}`);
    if (gated && previous != null && metrics[key] != null && metrics[key] < previous - 1e-9) {
      regressions.push(`${label} ${previous.toFixed(2)} -> ${metrics[key].toFixed(2)}`);
    }
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
    console.error('\n[rag:eval] FAIL: metrics regressed against eval-baseline.json:');
    for (const line of regressions) console.error(`  ${line}`);
    console.error(
      '  Investigate, or re-baseline deliberately with `npm run rag:eval -- --update-baseline`.',
    );
    exitCode = 1;
  }

  if (exitCode === 0) console.log('\n[rag:eval] OK');
  return exitCode;
}
