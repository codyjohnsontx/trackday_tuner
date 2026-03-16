import { buildCitations } from '@/lib/rag/citations';
import { loadRagIndex } from '@/lib/rag/index-store';
import { createOpenAIRagProvider } from '@/lib/rag/openai-provider';
import { retrieveRelevantChunks } from '@/lib/rag/retrieval';
import type { RagProvider } from '@/lib/rag/provider';
import type { RagIndex, RagQueryRequest, RagQueryResponse } from '@/lib/rag/types';

export class RagValidationError extends Error {}
export class RagIndexMissingError extends Error {}

interface RagQueryDependencies {
  provider?: RagProvider;
  loadIndex?: () => Promise<RagIndex | null>;
}

const NO_CONTEXT_RESPONSE: RagQueryResponse = {
  answer: "I don't have enough grounded Track Tuner context to answer that yet.",
  citations: [],
  missing_info: ['No relevant knowledge-base or session-log context was found for this question.'],
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validateRagQueryRequest(input: unknown): RagQueryRequest {
  if (!input || typeof input !== 'object') {
    throw new RagValidationError('Request body must be an object.');
  }

  const request = input as Record<string, unknown>;
  const question = typeof request.question === 'string' ? request.question.trim() : '';

  if (question.length < 8) {
    throw new RagValidationError('Question must be at least 8 characters.');
  }

  if (question.length > 500) {
    throw new RagValidationError('Question must be 500 characters or fewer.');
  }

  const filtersInput = request.filters;
  const filters = filtersInput && typeof filtersInput === 'object' ? (filtersInput as Record<string, unknown>) : undefined;

  const track = typeof filters?.track === 'string' ? filters.track.trim() : undefined;
  const bike = typeof filters?.bike === 'string' ? filters.bike.trim() : undefined;
  const dateFrom = typeof filters?.dateFrom === 'string' ? filters.dateFrom.trim() : undefined;
  const dateTo = typeof filters?.dateTo === 'string' ? filters.dateTo.trim() : undefined;

  if (dateFrom && !isIsoDate(dateFrom)) {
    throw new RagValidationError('dateFrom must use YYYY-MM-DD.');
  }

  if (dateTo && !isIsoDate(dateTo)) {
    throw new RagValidationError('dateTo must use YYYY-MM-DD.');
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new RagValidationError('dateFrom cannot be later than dateTo.');
  }

  return {
    question,
    filters:
      track || bike || dateFrom || dateTo
        ? {
            ...(track ? { track } : {}),
            ...(bike ? { bike } : {}),
            ...(dateFrom ? { dateFrom } : {}),
            ...(dateTo ? { dateTo } : {}),
          }
        : undefined,
  };
}

function sanitizeUsedChunkIds(retrievedChunkIds: string[], usedChunkIds: string[]): string[] {
  const allowed = new Set(retrievedChunkIds);
  return usedChunkIds.filter((chunkId) => allowed.has(chunkId));
}

export async function runRagQuery(
  input: unknown,
  dependencies: RagQueryDependencies = {}
): Promise<RagQueryResponse> {
  const request = validateRagQueryRequest(input);
  const index = await (dependencies.loadIndex ?? loadRagIndex)();

  if (!index) {
    throw new RagIndexMissingError('RAG index not built. Run npm run rag:index.');
  }

  const provider = dependencies.provider ?? createOpenAIRagProvider();
  const [queryEmbedding] = await provider.embedTexts([request.question]);
  const retrievedChunks = retrieveRelevantChunks({
    index,
    queryEmbedding: queryEmbedding ?? [],
    filters: request.filters,
  });

  if (retrievedChunks.length === 0) {
    return NO_CONTEXT_RESPONSE;
  }

  const result = await provider.generateAnswer({
    question: request.question,
    retrievedChunks,
  });

  const validUsedChunkIds = sanitizeUsedChunkIds(
    retrievedChunks.map((chunk) => chunk.chunkId),
    result.usedChunkIds
  );

  const fallbackChunkIds = retrievedChunks.slice(0, 3).map((chunk) => chunk.chunkId);
  const usedChunkIds = validUsedChunkIds.length > 0 ? validUsedChunkIds : fallbackChunkIds;
  const answer = result.answer.trim() || 'I could not produce a grounded answer from the provided context.';
  const missingInfo =
    validUsedChunkIds.length > 0
      ? result.missingInfo
      : ['Model output was invalid or insufficiently grounded.'];

  return {
    answer,
    citations: buildCitations(retrievedChunks, usedChunkIds),
    missing_info: missingInfo,
  };
}
