import OpenAI from 'openai';
import { getOpenAIApiKey, getOpenAIChatModel, getOpenAIEmbedModel } from '@/lib/env';
import type { RagProvider } from '@/lib/rag/provider';

const DEFAULT_CHAT_MODEL = getOpenAIChatModel();
const DEFAULT_EMBED_MODEL = getOpenAIEmbedModel();

export class OpenAIRagProviderError extends Error {
  phase: 'embedding' | 'generation';
  statusCode?: number;
  providerCode?: string;

  constructor(
    message: string,
    options: {
      phase: 'embedding' | 'generation';
      statusCode?: number;
      providerCode?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'OpenAIRagProviderError';
    this.phase = options.phase;
    this.statusCode = options.statusCode;
    this.providerCode = options.providerCode;

    if ('cause' in Error.prototype) {
      this.cause = options.cause;
    }
  }
}

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: getOpenAIApiKey() });
}

function normalizeOpenAIError(
  error: unknown,
  phase: 'embedding' | 'generation',
): OpenAIRagProviderError {
  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : undefined;
  const providerCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : undefined;

  return new OpenAIRagProviderError('AI service is currently unavailable.', {
    phase,
    statusCode,
    providerCode,
    cause: error,
  });
}

function parseModelJson(content: string | null | undefined): {
  answer: string;
  used_chunk_ids: string[];
  missing_info: string[];
} {
  if (!content) {
    throw new Error('Empty model response.');
  }

  const parsed = JSON.parse(content) as {
    answer?: unknown;
    used_chunk_ids?: unknown;
    missing_info?: unknown;
  };

  return {
    answer: typeof parsed.answer === 'string' ? parsed.answer.trim() : '',
    used_chunk_ids: Array.isArray(parsed.used_chunk_ids)
      ? parsed.used_chunk_ids.filter((item): item is string => typeof item === 'string')
      : [],
    missing_info: Array.isArray(parsed.missing_info)
      ? parsed.missing_info.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export function getDefaultEmbeddingModel(): string {
  return DEFAULT_EMBED_MODEL;
}

export function createOpenAIRagProvider(): RagProvider {
  return {
    async embedTexts(input: string[]) {
      if (input.length === 0) {
        return [];
      }

      try {
        const client = getOpenAIClient();
        const response = await client.embeddings.create({
          model: DEFAULT_EMBED_MODEL,
          input,
        });

        return response.data.map((item) => item.embedding);
      } catch (error) {
        throw normalizeOpenAIError(error, 'embedding');
      }
    },

    async generateAnswer({ question, retrievedChunks }) {
      try {
        const client = getOpenAIClient();
        const response = await client.chat.completions.create({
          model: DEFAULT_CHAT_MODEL,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You answer using only the provided Track Tuner context. Do not invent setup facts. If the context is incomplete, say so clearly. Return valid JSON with keys answer, used_chunk_ids, missing_info.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                question,
                context_chunks: retrievedChunks.map((chunk) => ({
                  chunk_id: chunk.chunkId,
                  title: chunk.title,
                  source_type: chunk.sourceType,
                  text: chunk.text,
                })),
              }),
            },
          ],
        });

        const parsed = parseModelJson(response.choices[0]?.message?.content);

        return {
          answer: parsed.answer,
          usedChunkIds: parsed.used_chunk_ids,
          missingInfo: parsed.missing_info,
        };
      } catch (error) {
        throw normalizeOpenAIError(error, 'generation');
      }
    },
  };
}
