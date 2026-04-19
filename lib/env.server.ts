import 'server-only';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
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
