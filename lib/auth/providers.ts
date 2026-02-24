export type OAuthProvider = 'google' | 'apple';

export interface OAuthProviderConfig {
  id: OAuthProvider;
  label: string;
  enabled: boolean;
}

function parseEnabledFlag(value: string | undefined): boolean {
  return value === 'true';
}

export function getOAuthProviders(): OAuthProviderConfig[] {
  return [
    {
      id: 'google',
      label: 'Google',
      enabled: parseEnabledFlag(process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED),
    },
    {
      id: 'apple',
      label: 'Apple',
      enabled: parseEnabledFlag(process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED),
    },
  ];
}
