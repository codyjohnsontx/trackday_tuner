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

  it('still returns a sentence for an unknown code', () => {
    const message = authErrorMessage('something_new');

    expect(message).toBeTruthy();
    expect(message).not.toContain('something_new');
  });
});
