function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  return value;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return value === 'true';
}

export function getSupabaseUrl(): string {
  return readEnv('NEXT_PUBLIC_SUPABASE_URL');
}

export function getSupabaseAnonKey(): string {
  return readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
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

export function getPublicAppUrl(): string {
  return readEnv('NEXT_PUBLIC_APP_URL');
}

export function getFounderPromoCodeEnv(): string | undefined {
  return (
    readOptionalEnv('NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE') ??
    readOptionalEnv('FOUNDER_PROMO_CODE')
  );
}

export function isGoogleAuthEnabled(): boolean {
  return readBooleanEnv('NEXT_PUBLIC_AUTH_GOOGLE_ENABLED', true);
}

export function isAppleAuthEnabled(): boolean {
  return readBooleanEnv('NEXT_PUBLIC_AUTH_APPLE_ENABLED', false);
}
