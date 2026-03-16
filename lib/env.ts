const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = readEnv(name);
  if (!value) {
    return fallback;
  }

  return TRUE_VALUES.has(value);
}

function readNumberEnv(name: string, fallback: number): number {
  const value = readEnv(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: expected a number.`);
  }

  return parsed;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = readNumberEnv(name, fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer.`);
  }

  return parsed;
}

function readPublicEnv(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getSupabaseUrl(): string {
  const value = readPublicEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!value) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL.');
  }

  return value;
}

export function getSupabaseAnonKey(): string {
  const value = readPublicEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!value) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return value;
}

export function getSupabaseServiceRoleKey(): string {
  return readRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
}

export function isGoogleAuthEnabled(): boolean {
  return TRUE_VALUES.has(readPublicEnv(process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED) ?? 'true');
}

export function isAppleAuthEnabled(): boolean {
  return TRUE_VALUES.has(readPublicEnv(process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED) ?? '');
}

export function getStripeSecretKey(): string {
  return readRequiredEnv('STRIPE_SECRET_KEY');
}

export function getStripeWebhookSecret(): string {
  return readRequiredEnv('STRIPE_WEBHOOK_SECRET');
}

export function getStripeProMonthlyPriceId(): string {
  return readRequiredEnv('STRIPE_PRO_MONTHLY_PRICE_ID');
}

export function getPublicAppUrl(): string {
  const value = readPublicEnv(process.env.NEXT_PUBLIC_APP_URL);
  if (!value) {
    throw new Error('Missing NEXT_PUBLIC_APP_URL.');
  }

  return value;
}

export function getFounderPromoCodeEnv(): string | undefined {
  return readPublicEnv(process.env.NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE);
}

export function getOpenAIApiKey(): string {
  return readRequiredEnv('OPENAI_API_KEY');
}

export function getOpenAIChatModel(): string {
  return readEnv('OPENAI_CHAT_MODEL') ?? 'gpt-4.1-mini';
}

export function getOpenAIEmbedModel(): string {
  return readEnv('OPENAI_EMBED_MODEL') ?? 'text-embedding-3-small';
}

export function getRagEvalBaseUrl(): string {
  return readEnv('RAG_EVAL_BASE_URL') ?? 'http://127.0.0.1:3000';
}

export function isRagEnabled(): boolean {
  return readBooleanEnv('RAG_ENABLED', true);
}

export function getRagDailyLimit(): number {
  return readPositiveIntegerEnv('RAG_DAILY_LIMIT', 3);
}

export function getRagRateLimitMaxRequests(): number {
  return readPositiveIntegerEnv('RAG_RATE_LIMIT_MAX_REQUESTS', 2);
}

export function getRagRateLimitWindowMs(): number {
  return readPositiveIntegerEnv('RAG_RATE_LIMIT_WINDOW_MS', 60_000);
}
