// Fixture only. See README.md in this directory. An RPC name the sweep cannot
// read, which must be reported rather than silently counted as covered.
type Rpc = { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };

export async function callByName(supabase: Rpc, name: string) {
  return supabase.rpc(name, {});
}
