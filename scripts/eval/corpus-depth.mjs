/**
 * How much knowledge an answer is actually built on, and where the corpus runs
 * out.
 *
 * The survey finding this answers (finding 9) was an arithmetic claim: the
 * corpus averages ~45 words per chunk, production retrieves at top-k 4,
 * therefore each answer is grounded in roughly 180 words of generic theory.
 * Both halves of that are averages over the INDEX, and neither was measured
 * over an ANSWER. A case can retrieve four chunks of one file, or four of the
 * longest chunks in the corpus, or - when the retriever filters by vehicle type
 * - fewer than four; the prompt then truncates each excerpt. So the figure a
 * rider's answer was actually grounded in is a different number from 45 x 4,
 * and this file is the harness measuring it rather than restating the claim.
 *
 * EVERY FIGURE HERE IS REPORTED AND NONE IS GATED, deliberately and on two
 * grounds. A gate needs a direction that is bad, and this one has none: more
 * words is not better (a long chunk off-topic is worse than a short one on it),
 * so neither a rise nor a fall is a regression on its own. And the remedy for a
 * thin corpus is to grow the corpus, which is a product investment decision
 * that this harness must inform rather than force - a gate here would make that
 * decision by refusing CI until somebody took it.
 *
 * The words counted are the EXCERPT the prompt prints, not the raw chunk, and
 * `excerptOf` is passed in by the caller so it can be production's own
 * `truncateAtWordBoundary` at production's own `EXCERPT_MAX_CHARS`. A hand copy
 * of that limit is the mistake `retrieval.mjs` records having made with `topK`:
 * it agrees on the day it is written and silently stops agreeing on the edit
 * this harness exists to support.
 */

export function countWords(text) {
  const trimmed = String(text ?? '').trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * What one answer was grounded in, or `null` when the retriever never ran for
 * it - a classifier refusal returns before `generateTuningAdvice`, and a zero
 * there would say the model was handed nothing when in truth it was never
 * asked. That is the same distinction `scoreRetrieval` draws, for the same
 * reason.
 *
 * @param {Array<{chunk: {source: string, text: string}}> | null} retrieved
 * @param {(text: string) => string} excerptOf  production's prompt truncation
 */
export function summarizeContext(retrieved, excerptOf) {
  if (retrieved == null) return null;
  return {
    chunks: retrieved.length,
    words: retrieved.reduce((sum, { chunk }) => sum + countWords(excerptOf(chunk.text)), 0),
    sources: new Set(retrieved.map(({ chunk }) => chunk.source)).size,
  };
}

/**
 * Means over the cases that retrieved, and `null` over none of them.
 *
 * EMPTY IS NOT ZERO. A run where every case was refused before the retriever
 * ran has not measured a narrow corpus; it has measured nothing, and reporting
 * `0 words` would read as the most alarming possible result of a measurement
 * that never happened.
 *
 * @param {Array<{id: string, contextDepth: {chunks: number, words: number, sources: number} | null}>} perCase
 */
export function aggregateContext(perCase) {
  const ran = perCase.filter((entry) => entry.contextDepth != null);
  if (ran.length === 0) {
    return { cases: 0, words: null, chunks: null, sources: null, thinnest: null };
  }
  const mean = (pick) => ran.reduce((sum, entry) => sum + pick(entry.contextDepth), 0) / ran.length;
  // The mean is what the claim was about; the floor is what a rider can
  // actually get, and it is the figure worth arguing over when deciding
  // whether the corpus is deep enough.
  const thinnest = ran.reduce((worst, entry) =>
    entry.contextDepth.words < worst.contextDepth.words ? entry : worst,
  );
  return {
    cases: ran.length,
    words: mean((g) => g.words),
    chunks: mean((g) => g.chunks),
    sources: mean((g) => g.sources),
    thinnest: { id: thinnest.id, words: thinnest.contextDepth.words },
  };
}

/**
 * The index the answers were drawn from. Read off the loaded index rather than
 * off `docs/knowledge-base/` so it describes what production would retrieve
 * from, which is the built artefact and not the markdown behind it.
 */
export function describeCorpus(chunks) {
  if (chunks.length === 0) {
    return { chunks: 0, sources: 0, words_per_chunk: null, words: 0 };
  }
  const words = chunks.reduce((sum, chunk) => sum + countWords(chunk.text), 0);
  return {
    chunks: chunks.length,
    sources: new Set(chunks.map((chunk) => chunk.source)).size,
    words_per_chunk: words / chunks.length,
    words,
  };
}

/**
 * Which labelled sources the retriever did not reach, hardest first. Recall@k
 * says how much of the label set was found; this says WHICH document keeps
 * being the one missing, which is the difference between a retrieval problem
 * spread thinly and one file the corpus cannot answer from.
 *
 * Counted over the cases that labelled the source, so the denominator is the
 * number of chances it had rather than the size of the golden set.
 */
export function tallyMissedSources(perCase) {
  const expected = new Map();
  const missed = new Map();
  for (const entry of perCase) {
    if (!entry.retrieval?.applicable) continue;
    for (const source of entry.labels?.expected_sources ?? []) {
      expected.set(source, (expected.get(source) ?? 0) + 1);
    }
    for (const source of entry.retrieval.missed) {
      missed.set(source, (missed.get(source) ?? 0) + 1);
    }
  }
  return [...missed.entries()]
    .map(([source, misses]) => ({ source, misses, labelled: expected.get(source) }))
    .sort((a, b) => b.misses - a.misses || a.source.localeCompare(b.source));
}

/**
 * What a `--live` run spends, in the only unit this repository can measure
 * without going stale: tokens. A price table committed here would be a number
 * nobody re-checks, drifting silently against the vendor's - and the model is
 * about to change, which is exactly when a stale price misleads most. The
 * dollar figure, its prices and the date they were read live in AGENTS.md,
 * derived from these counts.
 *
 * Offline replay spends none of it. The counts are still real on an offline
 * run, because they are read from the recorded responses, so the figure below
 * is what re-recording this set would cost.
 *
 * A call whose response carried no `usage` object is UNMEASURED rather than
 * free - the same empty-is-not-zero rule the rest of this file applies. It
 * counts toward `calls` and not toward `measured_calls`, its tokens are not
 * summed, and a model no call reported usage for totals `null` rather than 0,
 * because a confidently wrong cost is worse than an admittedly unknown one and
 * a model change is exactly when a provider stops filling that field.
 */
export function aggregateUsage(perCase) {
  const byModel = new Map();
  for (const entry of perCase) {
    if (entry.usage == null || entry.model == null) continue;
    const totals = byModel.get(entry.model) ?? {
      calls: 0,
      measured_calls: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
    };
    totals.calls += 1;
    const prompt = entry.usage.prompt_tokens;
    const completion = entry.usage.completion_tokens;
    if (typeof prompt === 'number' && typeof completion === 'number') {
      totals.measured_calls += 1;
      totals.prompt_tokens += prompt;
      totals.completion_tokens += completion;
    }
    byModel.set(entry.model, totals);
  }
  return [...byModel.entries()]
    .map(([model, totals]) => ({
      model,
      ...totals,
      prompt_tokens: totals.measured_calls === 0 ? null : totals.prompt_tokens,
      completion_tokens: totals.measured_calls === 0 ? null : totals.completion_tokens,
    }))
    .sort((a, b) => a.model.localeCompare(b.model));
}
