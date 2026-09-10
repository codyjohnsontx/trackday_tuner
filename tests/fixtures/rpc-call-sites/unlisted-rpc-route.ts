// Fixture only. See README.md in this directory.
type Rpc = { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };

export async function archiveRiderHistory(supabase: Rpc, userId: string) {
  return supabase.rpc('archive_rider_history', { p_user_id: userId });
}
