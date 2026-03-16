import { isAppleAuthEnabled, isGoogleAuthEnabled } from '@/lib/env';

export type OAuthProvider = 'google' | 'apple';

export interface OAuthProviderConfig {
  id: OAuthProvider;
  label: string;
  enabled: boolean;
}

export function getOAuthProviders(): OAuthProviderConfig[] {
  return [
    {
      id: 'google',
      label: 'Google',
      enabled: isGoogleAuthEnabled(),
    },
    {
      id: 'apple',
      label: 'Apple',
      enabled: isAppleAuthEnabled(),
    },
  ];
}
