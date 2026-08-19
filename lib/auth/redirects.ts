const PROBE_ORIGIN = 'https://sanitize-next-path.invalid';

/**
 * A `next` path that is safe to redirect to, or `fallback` when it is not.
 *
 * `fallback` exists because the safe destination is the caller's to choose:
 * `/auth/callback` has just signed the rider in and belongs on `/dashboard`,
 * while `/demo/exit` has only dropped a cookie and belongs on `/login`. It is
 * not sanitized - pass a literal.
 */
export function sanitizeNextPath(nextPath: string | null, fallback = '/dashboard'): string {
  if (!nextPath) return fallback;
  if (!nextPath.startsWith('/')) return fallback;
  if (nextPath.startsWith('//')) return fallback;
  // WHATWG URL parsers treat \ as /, so a backslash anywhere can escape the host
  if (nextPath.includes('\\')) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(nextPath, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (resolved.origin !== PROBE_ORIGIN) return fallback;

  return nextPath;
}
