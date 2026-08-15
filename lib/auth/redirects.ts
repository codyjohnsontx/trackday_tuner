const PROBE_ORIGIN = 'https://sanitize-next-path.invalid';

export function sanitizeNextPath(nextPath: string | null): string {
  if (!nextPath) return '/dashboard';
  if (!nextPath.startsWith('/')) return '/dashboard';
  if (nextPath.startsWith('//')) return '/dashboard';
  // WHATWG URL parsers treat \ as /, so a backslash anywhere can escape the host
  if (nextPath.includes('\\')) return '/dashboard';

  let resolved: URL;
  try {
    resolved = new URL(nextPath, PROBE_ORIGIN);
  } catch {
    return '/dashboard';
  }
  if (resolved.origin !== PROBE_ORIGIN) return '/dashboard';

  return nextPath;
}
