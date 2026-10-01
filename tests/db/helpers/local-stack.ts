/**
 * Why `url` is not a local Supabase stack, or null when it is.
 *
 * The real-database suite signs up throwaway riders with the service role and
 * deletes them afterwards, and the config loads the app's own env files - so a
 * run without the `supabase status` export would aim at whatever project
 * `.env.local` names. Only a loopback host is a stack `supabase start` built on
 * this machine or runner, so nothing else is accepted.
 */
export function nonLocalSupabaseUrlReason(url: string | undefined): string | null {
  if (!url) return 'NEXT_PUBLIC_SUPABASE_URL is not set';
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return `NEXT_PUBLIC_SUPABASE_URL is not a URL: ${url}`;
  }
  if (hostname === 'localhost' || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname)) return null;
  return `NEXT_PUBLIC_SUPABASE_URL points at ${hostname}, not a local stack`;
}
