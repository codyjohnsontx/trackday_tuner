import { isAppleAuthEnabled, isGoogleAuthEnabled } from '@/lib/env.public';

export type OAuthProvider = 'google' | 'apple';

export interface OAuthProviderConfig {
  id: OAuthProvider;
  label: string;
  enabled: boolean;
}

const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  apple: 'Apple',
};

export function oauthProviderLabel(id: string | null | undefined): string | null {
  return id && Object.hasOwn(OAUTH_PROVIDER_LABELS, id) ? OAUTH_PROVIDER_LABELS[id as OAuthProvider] : null;
}

export function getOAuthProviders(): OAuthProviderConfig[] {
  return [
    {
      id: 'google',
      label: OAUTH_PROVIDER_LABELS.google,
      enabled: isGoogleAuthEnabled(),
    },
    {
      id: 'apple',
      label: OAUTH_PROVIDER_LABELS.apple,
      enabled: isAppleAuthEnabled(),
    },
  ];
}
