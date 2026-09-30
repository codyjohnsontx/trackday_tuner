import 'server-only';
import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import {
  getAiModel,
  getOpenAIApiKey,
} from '@/lib/env.server';
import { embedQuery } from '@/lib/rag/embed';
import type { AdviceMessages, PreparedAdvicePrompt } from '@/lib/rag/prompt';
import { retrieveRelevantChunks } from '@/lib/rag/retriever';
import {
  adviceResponseJsonSchema,
  DISCLAIMER_NOTE,
  ONE_CHANGE_NOTE,
  parseAdviceResponse,
  type AdviceResponse,
} from '@/lib/rag/schema';
import type { RetrievedChunk } from '@/lib/rag/types';

// Upper bound on the OpenAI chat completion request. Unchanged at 30s across
// the move to gpt-5.4-mini: all 28 completions of the `rag:eval` golden set
// answered inside it on the live re-record, on a payload the set is
// representative of. That is 28 samples rather than a production p95, so it is
// evidence the bound is not tight rather than a measurement of the margin.
// Short enough, either way, that the route handler can surface a retriable 504.
const OPENAI_REQUEST_TIMEOUT_MS = 30_000;

export class UpstreamTimeoutError extends Error {
  constructor(cause: unknown) {
    super('Upstream tuning-advice call timed out.');
    this.name = 'UpstreamTimeoutError';
    this.cause = cause;
  }
}

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: getOpenAIApiKey(),
      timeout: OPENAI_REQUEST_TIMEOUT_MS,
    });
  }
  return cachedClient;
}

export interface GenerateAdviceResult {
  advice: AdviceResponse;
  retrieved: RetrievedChunk[];
  usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
  };
  latencyMs: number;
  model: string;
}

function ensureSafetyNotes(advice: AdviceResponse): AdviceResponse {
  const notes = [...advice.safety_notes];
  const normalized = new Set(notes.map((n) => n.trim().toLowerCase()));
  if (!normalized.has(DISCLAIMER_NOTE.toLowerCase())) notes.push(DISCLAIMER_NOTE);
  if (!normalized.has(ONE_CHANGE_NOTE.toLowerCase())) notes.push(ONE_CHANGE_NOTE);
  return { ...advice, safety_notes: notes };
}

function filterCitationsToRetrievedSources(
  advice: AdviceResponse,
  retrieved: RetrievedChunk[],
): AdviceResponse {
  const allowed = new Set(retrieved.map(({ chunk }) => chunk.source));
  const filtered = advice.citations.filter((c) => allowed.has(c.source));
  if (filtered.length === advice.citations.length) return advice;
  return { ...advice, citations: filtered };
}

async function completeAdvice(params: {
  messages: AdviceMessages;
  retrieved: RetrievedChunk[];
}): Promise<{
  advice: AdviceResponse;
  usage: GenerateAdviceResult['usage'];
  latencyMs: number;
  model: string;
}> {
  const model = getAiModel();
  const client = getClient();
  const start = Date.now();
  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        messages: params.messages,
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: adviceResponseJsonSchema,
        },
      },
      { timeout: OPENAI_REQUEST_TIMEOUT_MS },
    );
  } catch (err) {
    if (err instanceof APIConnectionTimeoutError || err instanceof APIUserAbortError) {
      throw new UpstreamTimeoutError(err);
    }
    throw err;
  }
  const latencyMs = Date.now() - start;

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Model returned no content.');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error('Model returned invalid JSON.');
  }

  const parsed = parseAdviceResponse(parsedJson);
  if (!parsed.ok) {
    throw new Error(`Response did not match schema: ${parsed.error}`);
  }

  // Strip any citations whose source is not in the retrieved set (the model
  // should never invent knowledge-base paths; defense in depth).
  const sanitized = filterCitationsToRetrievedSources(parsed.data, params.retrieved);

  return {
    advice: ensureSafetyNotes(sanitized),
    usage: {
      prompt_tokens: completion.usage?.prompt_tokens ?? null,
      completion_tokens: completion.usage?.completion_tokens ?? null,
    },
    latencyMs,
    model,
  };
}

/**
 * Retrieve knowledge for a prepared prompt and ask the model.
 *
 * Both AI routes call this with what their prompt module's `prepare*` function
 * returned (`lib/rag/prompt.ts`). It reads nothing about the route: the
 * retrieval query and the messages both come from the prepared prompt, so the
 * prompt the model sees is built exactly once, from the input the route
 * screened.
 */
export async function generateAdvice(
  prompt: PreparedAdvicePrompt,
): Promise<GenerateAdviceResult> {
  const queryEmbedding = await embedQuery(prompt.retrieval.query);
  const retrieved = await retrieveRelevantChunks(queryEmbedding, {
    vehicleType: prompt.retrieval.vehicleType,
    topK: 4,
    maxK: 8,
  });

  const result = await completeAdvice({ messages: prompt.messages(retrieved), retrieved });

  return {
    advice: result.advice,
    retrieved,
    usage: result.usage,
    latencyMs: result.latencyMs,
    model: result.model,
  };
}
