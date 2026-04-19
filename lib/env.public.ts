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
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid boolean environment variable ${name}: ${value}`);
}

export function getSupabaseUrl(): string {
  return readEnv('NEXT_PUBLIC_SUPABASE_URL');
}

export function getSupabaseAnonKey(): string {
  return readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export function getPublicAppUrl(): string {
  return readEnv('NEXT_PUBLIC_APP_URL');
}

export function getFounderPromoCodeEnv(): string | undefined {
  return readOptionalEnv('NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE');
}

export function isGoogleAuthEnabled(): boolean {
  return readBooleanEnv('NEXT_PUBLIC_AUTH_GOOGLE_ENABLED', true);
}

export function isAppleAuthEnabled(): boolean {
  return readBooleanEnv('NEXT_PUBLIC_AUTH_APPLE_ENABLED', false);
}
