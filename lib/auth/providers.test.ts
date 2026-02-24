import { afterEach, describe, expect, it } from 'vitest';
import { getOAuthProviders } from '@/lib/auth/providers';

describe('getOAuthProviders', () => {
  const originalGoogleFlag = process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED;
  const originalAppleFlag = process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED;

  afterEach(() => {
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = originalGoogleFlag;
    process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED = originalAppleFlag;
  });

  it('enables providers only when env flag equals true', () => {
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = 'true';
    process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED = 'TRUE';

    const providers = getOAuthProviders();
    const google = providers.find((provider) => provider.id === 'google');
    const apple = providers.find((provider) => provider.id === 'apple');

    expect(google?.enabled).toBe(true);
    expect(apple?.enabled).toBe(false);
  });

  it('keeps provider metadata stable', () => {
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = 'false';
    process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED = 'false';

    expect(getOAuthProviders()).toEqual([
      { id: 'google', label: 'Google', enabled: false },
      { id: 'apple', label: 'Apple', enabled: false },
    ]);
  });
});
