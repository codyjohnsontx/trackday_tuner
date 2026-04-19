function readEnv(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return normalized;
}

function readOptionalEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

function readBooleanEnv(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Invalid boolean environment variable ${name}: ${normalized}`);
}

export function getSupabaseUrl(): string {
  return readEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function getSupabaseAnonKey(): string {
  return readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function getPublicAppUrl(): string {
  return readEnv('NEXT_PUBLIC_APP_URL', process.env.NEXT_PUBLIC_APP_URL);
}

export function getFounderPromoCodeEnv(): string | undefined {
  return readOptionalEnv(process.env.NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE);
}

export function isGoogleAuthEnabled(): boolean {
  return readBooleanEnv(
    'NEXT_PUBLIC_AUTH_GOOGLE_ENABLED',
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED,
    true,
  );
}

export function isAppleAuthEnabled(): boolean {
  return readBooleanEnv(
    'NEXT_PUBLIC_AUTH_APPLE_ENABLED',
    process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED,
    false,
  );
}
