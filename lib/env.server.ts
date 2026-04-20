import 'server-only';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value.trim();
}

export function getSupabaseServiceRoleKey(): string {
  return readEnv('SUPABASE_SERVICE_ROLE_KEY');
}

export function getStripeSecretKey(): string {
  return readEnv('STRIPE_SECRET_KEY');
}

export function getStripeProMonthlyPriceId(): string {
  return readEnv('STRIPE_PRO_MONTHLY_PRICE_ID');
}

export function getStripeWebhookSecret(): string {
  return readEnv('STRIPE_WEBHOOK_SECRET');
}

export function getOpenAIApiKey(): string {
  return readEnv('OPENAI_API_KEY');
}

export function getAiModel(): string {
  const value = process.env.AI_MODEL?.trim();
  return value && value.length > 0 ? value : 'gpt-4o-mini';
}

export function getAiEmbeddingModel(): string {
  const value = process.env.AI_EMBEDDING_MODEL?.trim();
  return value && value.length > 0 ? value : 'text-embedding-3-small';
}

export function getAiRateLimitPerHour(): number {
  const raw = process.env.AI_RATE_LIMIT_PER_HOUR?.trim();
  if (!raw) return 20;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid AI_RATE_LIMIT_PER_HOUR: ${raw}`);
  }
  return Math.floor(parsed);
}

export function getAiRateLimitPerMinute(): number {
  const raw = process.env.AI_RATE_LIMIT_PER_MINUTE?.trim();
  if (!raw) return 3;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid AI_RATE_LIMIT_PER_MINUTE: ${raw}`);
  }
  return Math.floor(parsed);
}
