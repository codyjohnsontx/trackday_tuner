import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '@/lib/auth/messages';

describe('authErrorMessage', () => {
  it('returns nothing when there is no error code', () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage(undefined)).toBeNull();
    expect(authErrorMessage('')).toBeNull();
  });

  it('explains a failed auth callback', () => {
    expect(authErrorMessage('auth_callback_failed')).toContain('expire');
  });

  it('names the provider that did not verify the email, and points at email and password', () => {
    expect(authErrorMessage('provider_email_unverified', 'google')).toBe(
      "We couldn't sign you in with Google because that email isn't verified with Google. Sign in with your email and password instead."
    );
    expect(authErrorMessage('provider_email_unverified', 'apple')).toContain('verified with Apple');
  });

  it('stays provider-neutral when the provider is missing or unknown', () => {
    const neutral =
      "We couldn't sign you in because that email isn't verified with the provider you chose. Sign in with your email and password instead.";

    expect(authErrorMessage('provider_email_unverified')).toBe(neutral);
    expect(authErrorMessage('provider_email_unverified', 'toString')).toBe(neutral);
    expect(authErrorMessage('provider_email_unverified', '<b>evil</b>')).toBe(neutral);
  });

  it('still returns a sentence for an unknown code', () => {
    const message = authErrorMessage('something_new');

    expect(message).toBeTruthy();
    expect(message).not.toContain('something_new');
  });
});
