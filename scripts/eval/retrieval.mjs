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

/** The k the production route retrieves at (`topK: 4` in lib/rag/advice.ts). */
export const RETRIEVAL_K = 4;

/**
 * @param {string[]} retrievedSources  source path per retrieved chunk, in rank order
 * @param {string[]} expectedSources   the sources this case should surface
 * @param {number} k
 */
export function scoreRetrieval(retrievedSources, expectedSources, k = RETRIEVAL_K) {
  if (expectedSources.length === 0) {
    // Cases with nothing to retrieve - a refusal that never reaches the
    // retriever - are not scored rather than scored zero, which would drag the
    // aggregate down for behaving correctly.
    return { applicable: false, recall: null, reciprocalRank: null, hits: [], missed: [] };
  }

  const topK = retrievedSources.slice(0, k);
  const expected = new Set(expectedSources);
  const hits = [...new Set(topK.filter((source) => expected.has(source)))];
  const missed = expectedSources.filter((source) => !topK.includes(source));

  const firstRelevantIndex = topK.findIndex((source) => expected.has(source));
  const reciprocalRank = firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1);

  return {
    applicable: true,
    recall: hits.length / expected.size,
    reciprocalRank,
    hits,
    missed,
  };
}

/** Mean over the cases that had a label, or null when none did. */
export function aggregateRetrieval(perCase) {
  const scored = perCase.filter((entry) => entry.applicable);
  if (scored.length === 0) return { cases: 0, recall: null, mrr: null };
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    cases: scored.length,
    recall: mean(scored.map((entry) => entry.recall)),
    mrr: mean(scored.map((entry) => entry.reciprocalRank)),
  };
}
