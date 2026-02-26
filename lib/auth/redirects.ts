export function sanitizeNextPath(nextPath: string | null): string {
  if (!nextPath) return '/dashboard';
  if (!nextPath.startsWith('/')) return '/dashboard';
  if (nextPath.startsWith('//')) return '/dashboard';
  return nextPath;
}
