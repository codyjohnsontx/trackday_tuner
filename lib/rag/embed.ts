import 'server-only';
import OpenAI from 'openai';
import { getAiEmbeddingModel, getOpenAIApiKey } from '@/lib/env.server';

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey: getOpenAIApiKey() });
  }
  return cachedClient;
}

export async function embedQuery(text: string): Promise<number[]> {
  const client = getClient();
  const model = getAiEmbeddingModel();
  const response = await client.embeddings.create({
    model,
    input: text,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error('Embedding provider returned no data.');
  }
  return embedding;
}
