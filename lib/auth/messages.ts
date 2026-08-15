/**
 * `/auth/callback` can only hand a failure back to `/login` through the URL, so
 * it sends a short stable code rather than a sentence. This is where that code
 * becomes something a rider can act on.
 *
 * An unrecognised code still produces a sentence. The alternative is a login
 * page that bounced the rider for no visible reason, which is how a working
 * account reads as a broken app.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  auth_callback_failed:
    'That link did not work. Email links expire, are single use, and only open in the browser that asked for them. Use "Forgot your password?" to send yourself a new one.',
};

const FALLBACK_AUTH_ERROR = 'We could not finish that step. Please try again.';

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;

  return AUTH_ERROR_MESSAGES[code] ?? FALLBACK_AUTH_ERROR;
}
