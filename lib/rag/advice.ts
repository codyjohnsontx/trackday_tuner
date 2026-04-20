import 'server-only';
import OpenAI from 'openai';
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

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey: getOpenAIApiKey() });
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
  if (!notes.some((n) => n.includes('informational'))) notes.push(DISCLAIMER_NOTE);
  if (!notes.some((n) => n.toLowerCase().includes('one change'))) notes.push(ONE_CHANGE_NOTE);
  return { ...advice, safety_notes: notes };
}

export async function generateTuningAdvice(
  input: GenerateAdviceInput,
): Promise<GenerateAdviceResult> {
  const vehicleType = input.vehicle.type;
  const symptomText = (input.symptoms ?? []).join(' ');
  const queryText = `${input.question}\n${symptomText}\n${input.changeIntent ?? ''}`.trim();

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
  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: adviceResponseJsonSchema,
    },
  });
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

  return {
    advice: ensureSafetyNotes(parsed.data),
    retrieved,
    usage: {
      prompt_tokens: completion.usage?.prompt_tokens ?? null,
      completion_tokens: completion.usage?.completion_tokens ?? null,
    },
    latencyMs,
    model,
  };
}
