export function sanitizeNextPath(nextPath: string | null): string {
  if (!nextPath) return '/dashboard';
  if (!nextPath.startsWith('/')) return '/dashboard';
  if (nextPath.startsWith('//')) return '/dashboard';
  // WHATWG URL parsers treat \ as /, so a backslash anywhere can escape the host
  if (nextPath.includes('\\')) return '/dashboard';
  return nextPath;
}
