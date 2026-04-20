import 'server-only';
import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import {
  getAiModel,
  getOpenAIApiKey,
} from '@/lib/env.server';
import { embedQuery } from '@/lib/rag/embed';
import { buildMessages, DISCLAIMER_NOTE, ONE_CHANGE_NOTE } from '@/lib/rag/prompt';
import { retrieveRelevantChunks } from '@/lib/rag/retriever';
import {
  adviceResponseJsonSchema,
  parseAdviceResponse,
  type AdviceResponse,
} from '@/lib/rag/schema';
import type { RetrievedChunk } from '@/lib/rag/types';
import type { Session, Vehicle } from '@/types';

// Upper bound on the OpenAI chat completion request. 30s is well above the
// p95 for gpt-4o-mini on our payload size and still short enough that the
// route handler can surface a retriable 504 to the client.
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

export interface GenerateAdviceInput {
  session: Session;
  previousSession: Session | null;
  vehicle: Vehicle;
  question: string;
  symptoms?: string[];
  changeIntent?: string;
  temperatureC?: number;
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

export async function generateTuningAdvice(
  input: GenerateAdviceInput,
): Promise<GenerateAdviceResult> {
  const vehicleType = input.vehicle.type;
  const symptomText = (input.symptoms ?? []).join(' ');
  const temperatureLine =
    input.temperatureC != null ? `ambient temperature ${input.temperatureC} C` : '';
  const queryText = [
    input.question,
    symptomText,
    input.changeIntent ?? '',
    temperatureLine,
  ]
    .filter((part) => part && part.trim().length > 0)
    .join('\n')
    .trim();

  const queryEmbedding = await embedQuery(queryText);
  const retrieved = await retrieveRelevantChunks(queryEmbedding, {
    vehicleType,
    topK: 4,
    maxK: 8,
  });

  const messages = buildMessages({
    session: input.session,
    previousSession: input.previousSession,
    vehicle: input.vehicle,
    question: input.question,
    symptoms: input.symptoms,
    changeIntent: input.changeIntent,
    temperatureC: input.temperatureC,
    retrieved,
  });

  const model = getAiModel();
  const client = getClient();
  const start = Date.now();
  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        messages,
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
  const sanitized = filterCitationsToRetrievedSources(parsed.data, retrieved);

  return {
    advice: ensureSafetyNotes(sanitized),
    retrieved,
    usage: {
      prompt_tokens: completion.usage?.prompt_tokens ?? null,
      completion_tokens: completion.usage?.completion_tokens ?? null,
    },
    latencyMs,
    model,
  };
}
