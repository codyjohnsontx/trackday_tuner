/**
 * Does the database this deployment is pointed at still expose the RPCs the app
 * calls?
 *
 * This exists because of the Save Outcome outage. `20260716000800` creates
 * `save_session_outcome`, nothing applies migrations automatically - `npm run
 * db:push` is a manual step - and a rider pressing "Save Outcome" got
 *
 *   Could not find the function public.save_session_outcome(p_notes, ...) in the
 *   schema cache
 *
 * with their typed notes unsaved. Pages served normally throughout: the drift is
 * invisible from everywhere except the one feature that needs the missing object.
 * That is the same shape as R3, which is why the answer lives beside the R3 check
 * in `lib/monitoring/health.ts` rather than in a script somebody has to remember
 * to run.
 *
 * WHY IT ASKS POSTGREST RATHER THAN THE CATALOG. Two different faults produce
 * that one error message, and they are byte-identical from the client - same
 * `PGRST202`, same message, same null hint (measured; see
 * `scripts/sql/audit-migrations-against-database.sql` for the other half of the
 * diagnosis):
 *
 *   - the migration was never applied, so the function is not in `pg_proc`
 *   - the function IS in `pg_proc`, but PostgREST's schema cache has not been
 *     reloaded, so the Data API cannot see it
 *
 * A check that read `pg_proc` would call the second one healthy while every
 * rider's save failed. So the probe goes through the Data API, exactly as the
 * rider's request does. It is the schema cache that has to know about the
 * function, because the schema cache is what the rider's call resolves against.
 *
 * WHY THE PROBE CANNOT RUN WHAT IT PROBES. PostgREST resolves an RPC from the
 * parameter NAMES in the body, and Postgres coerces the VALUES only afterwards.
 * So a payload carrying every real parameter name plus one value that no uuid or
 * integer column can parse proves resolution and is then rejected with `22P02`
 * before the function body executes. That matters concretely rather than
 * theoretically: `service_role` holds execute on `consume_beta_rate_limit`, so a
 * well-formed probe would spend a rate-limit slot on every health check. This was
 * verified against a real stack - the probe leaves `beta_rate_limits` empty.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

/**
 * PostgREST's code for "no function of that name and parameter set is in the
 * schema cache". The one code that means drift; every other outcome means the
 * Data API resolved the function, which is all this check asks.
 */
export const RPC_NOT_IN_SCHEMA_CACHE = 'PGRST202';

/**
 * A value no `uuid` and no `integer` parses. Every contract below puts it in at
 * least one such parameter, which is what keeps the probe from executing;
 * `schema-contract.test.ts` fails if one stops doing so.
 */
export const UNCOERCIBLE_PROBE_VALUE = 'trackday-tuner-health-probe';

type DatabaseFunction = keyof Database['public']['Functions'];

export interface RpcContract {
  /** The function name, as `supabase.rpc()` names it at the call site. */
  name: DatabaseFunction;
  /**
   * Every parameter name the deployment sends, with the uncoercible value in at
   * least one `uuid` or `integer` parameter. The names are the contract: they are
   * what PostgREST matches on, so a signature that drifted by one parameter fails
   * here the same way a missing function does.
   */
  probe: Record<string, unknown>;
}

/**
 * Builds a contract whose probe carries EXACTLY the parameters
 * `types/supabase.ts` declares for that function - no more and no fewer, checked
 * by the compiler.
 *
 * That generated `Args` type is the same one every real `supabase.rpc()` call
 * site is checked against, and `schema-contract.test.ts` holds the probe to the
 * migration that declares the function. So the two together tie a call site to
 * the SQL it needs applied: the neighbouring failure where a route and its
 * migration disagree by one parameter returns the SAME `PGRST202` a missing
 * function does, and fails to compile here instead of reaching a rider.
 */
function contract<Name extends DatabaseFunction>(
  name: Name,
  probe: { [Key in keyof Database['public']['Functions'][Name]['Args']]: unknown },
): RpcContract {
  return { name, probe };
}

/**
 * The RPCs a *deployment* calls. `create_beta_invite` is deliberately absent: it
 * is reached only from `scripts/beta-invites.mjs`, which an operator runs from a
 * laptop, so its absence breaks no rider request and would make this check fail
 * for something the deployment never touches.
 */
export const REQUIRED_RPCS: readonly RpcContract[] = [
  contract('save_session_outcome', {
    p_user_id: UNCOERCIBLE_PROBE_VALUE,
    p_session_id: UNCOERCIBLE_PROBE_VALUE,
    p_reference_session_id: UNCOERCIBLE_PROBE_VALUE,
    p_recommendation_id: null,
    p_outcome: 'better',
    p_rider_confidence: null,
    p_symptoms: [],
    p_notes: null,
    p_recommendation_helpfulness: null,
  }),
  contract('replace_session_laps', {
    p_user_id: UNCOERCIBLE_PROBE_VALUE,
    p_session_id: UNCOERCIBLE_PROBE_VALUE,
    p_laps: [],
    p_expected_laps: [],
  }),
  contract('consume_beta_rate_limit', {
    p_key_hash: UNCOERCIBLE_PROBE_VALUE,
    p_limit: UNCOERCIBLE_PROBE_VALUE,
    p_window_seconds: UNCOERCIBLE_PROBE_VALUE,
  }),
];

/** The names of the RPCs the Data API could not resolve, in contract order. */
export async function findUnresolvableRpcs(
  client: Pick<SupabaseClient, 'rpc'>,
): Promise<string[]> {
  const results = await Promise.all(
    REQUIRED_RPCS.map(async (required) => {
      // The generated `Database` types describe the arguments a caller is
      // supposed to send. This deliberately sends ones that cannot coerce, which
      // is the whole mechanism, so the call is made through an untyped view of
      // the client rather than by widening the types every real call site uses.
      // It stays a method call: `SupabaseClient.rpc` reads `this.rest`, so a
      // detached reference throws before it ever reaches PostgREST.
      const untyped = client as unknown as {
        rpc(name: string, args: Record<string, unknown>): PromiseLike<{
          error: { code?: string } | null;
        }>;
      };
      const { error } = await untyped.rpc(required.name, required.probe);
      return error?.code === RPC_NOT_IN_SCHEMA_CACHE ? required.name : null;
    }),
  );
  return results.filter((name): name is DatabaseFunction => name !== null);
}
