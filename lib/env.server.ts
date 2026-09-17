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

export function getAiRequestFingerprintSecret(): string {
  return readEnv('AI_REQUEST_FINGERPRINT_SECRET');
}

/**
 * The chat model the Race Engineer and the day planner run on.
 *
 * `gpt-5.4-mini` was chosen by measurement rather than by tier: `npm run rag:eval
 * -- --live` was run over the same 33 golden cases on four candidates, and this
 * one scored best. Against the `gpt-4o-mini` it replaces, direction accuracy went
 * 0.47 -> 0.87 and component accuracy 0.80 -> 0.87. It beat `gpt-5.1` on both at
 * 39% of its per-request cost, and `gpt-5.4` at 3.8x the cost was a clear
 * REGRESSION (rubric 0.94 -> 0.76, component 0.80 -> 0.73), which is why the
 * newest name is not the answer here. `gpt-5-mini` never reached the set: it
 * rejects the `temperature: 0.2` that `lib/rag/advice.ts` sends and bills
 * reasoning tokens as output, so it is excluded on compatibility, not on score.
 *
 * COMPONENT ACCURACY IS A 15-CASE RATE AND IT MOVES ON A RE-SAMPLE. Two live
 * runs of this model on an unchanged prompt scored it 1.00 and 0.87; the
 * committed tape is the second, because the baseline is whatever the run that
 * produced the committed recordings measured. Direction accuracy scored 0.87 on
 * both. Read a one-case difference here as sampling, not as a trend.
 *
 * Changing this moves every completion tape key in
 * `tests/fixtures/rag-eval/recordings/`, so a change here needs a
 * `--live` re-record and a deliberate `--update-baseline`.
 */
export function getAiModel(): string {
  const value = process.env.AI_MODEL?.trim();
  return value && value.length > 0 ? value : 'gpt-5.4-mini';
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

export function isBetaInviteOnly(): boolean {
  const value = process.env.BETA_INVITE_ONLY?.trim();
  if (!value) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid BETA_INVITE_ONLY: ${value}`);
}

export function getBetaInviteSecret(): string {
  return readEnv('BETA_INVITE_SECRET');
}

export function getBetaFormRateLimitSecret(): string {
  return process.env.BETA_FORM_RATE_LIMIT_SECRET?.trim() || getBetaInviteSecret();
}

/**
 * The shared secret the scheduled monitoring probe presents.
 *
 * Read through `readEnv`, so an unset value throws and
 * `/api/monitoring/ai-health` refuses every caller rather than serving the
 * numbers to anyone. `Authorization: Bearer <secret>` is also exactly what a
 * Vercel Cron job sends, so the same route works from either scheduler.
 */
export function getMonitoringCronSecret(): string {
  return readEnv('MONITORING_CRON_SECRET');
}

/** Optional. Absent means alerts reach the operator through the scheduled
 * probe's failed workflow run instead - see `lib/monitoring/alert.ts`. */
export function getMonitoringAlertWebhookUrl(): string | null {
  return process.env.MONITORING_ALERT_WEBHOOK_URL?.trim() || null;
}
