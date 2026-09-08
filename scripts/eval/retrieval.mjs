/**
 * Retrieval relevance, which is the half the old harness could not measure at
 * all: it never imported `lib/rag/` and never called an embedding or a
 * retriever, so "measured retrieval relevance" had no number behind it.
 *
 * Each golden case names the knowledge-base sources that SHOULD surface for its
 * question. The harness embeds the same query text `generateTuningAdvice`
 * builds, retrieves with the same parameters, and compares the ranked source
 * list against that label.
 *
 * RECALL IS OVER SOURCES, NOT CHUNKS. The index holds 4-6 chunks per file, so a
 * query that pulls three chunks of `tires/pressure-basics.md` has found one
 * relevant document, not three. Scoring chunks would let a single well-matched
 * file report perfect recall on a case that expects two.
 *
 * RANK IS THE CHUNK RANK. MRR asks how far down the retrieved list the rider's
 * first genuinely relevant document appears, and the list the model is handed is
 * a chunk list - so a relevant file first seen at chunk 3 has rank 3, whatever
 * its file position would have been after deduplication.
 */

/**
 * K IS PRODUCTION'S, AND IS OBSERVED RATHER THAN DECLARED. This file used to
 * hold `RETRIEVAL_K = 4`, a hand copy of the literal `topK: 4` that
 * `generateTuningAdvice` passes, with a comment asserting the two were the same
 * and nothing checking it. The copy was inert only because `selectTopChunks`
 * already caps the list, so the slice never removed anything - and it would have
 * stopped being inert on exactly the edit this harness exists to support:
 * raising `topK` to compare a retrieval change, whereupon the harness would have
 * scored the first four of six and still printed `recall@4`.
 *
 * The list production hands back IS the top-k, so the whole of it is scored and
 * `aggregateRetrieval` reports the k it observed. Production declares k once,
 * where it always did.
 */

/**
 * @param {string[] | null} retrievedSources  source path per retrieved chunk in
 *   rank order - the whole list production retrieved - or `null` when the
 *   retriever never ran
 * @param {string[]} expectedSources   the sources this case should surface
 */
export function scoreRetrieval(retrievedSources, expectedSources) {
  // Two different things are unscoreable and neither may be scored zero, which
  // would drag the aggregate down for behaving correctly. A case with no label
  // has nothing to compare against. A case refused before anything was embedded
  // never reached the retriever at all, so the number would be measuring the
  // classifier - `null` is that case, and an empty ARRAY still scores, because a
  // retriever that ran and returned nothing genuinely recalled nothing.
  if (retrievedSources == null || expectedSources.length === 0) {
    return {
      applicable: false,
      recall: null,
      reciprocalRank: null,
      hits: [],
      missed: [],
      retrieved: retrievedSources?.length ?? null,
    };
  }

  const expected = new Set(expectedSources);
  const hits = [...new Set(retrievedSources.filter((source) => expected.has(source)))];
  const missed = expectedSources.filter((source) => !retrievedSources.includes(source));

  const firstRelevantIndex = retrievedSources.findIndex((source) => expected.has(source));
  const reciprocalRank = firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1);

  return {
    applicable: true,
    recall: hits.length / expected.size,
    reciprocalRank,
    hits,
    missed,
    retrieved: retrievedSources.length,
  };
}

/**
 * Mean over the cases that had a label, or null when none did, plus `k` - the
 * longest list the retriever returned this run, over every case it ran for.
 * That is the k the metric was measured at, read off the pipeline rather than
 * asserted about it, so a `topK` change shows up as a changed k instead of a
 * quietly truncated score.
 */
export function aggregateRetrieval(perCase) {
  const ran = perCase.filter((entry) => entry.retrieved != null);
  const k = ran.length === 0 ? null : Math.max(...ran.map((entry) => entry.retrieved));
  const scored = perCase.filter((entry) => entry.applicable);
  if (scored.length === 0) return { cases: 0, recall: null, mrr: null, k };
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    cases: scored.length,
    recall: mean(scored.map((entry) => entry.recall)),
    mrr: mean(scored.map((entry) => entry.reciprocalRank)),
    k,
  };
}
