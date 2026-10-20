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
 * A function with no uuid or integer parameter cannot be poisoned that way, so
 * its probe does run, and it is listed only behind a `guard` (`RpcContract`).
 *
 * WHAT IT CANNOT SEE, recorded rather than built for. Resolution is by parameter
 * NAME, so a migration that changed a parameter's TYPE while keeping its name
 * would still resolve here and the check would call the deployment in step. No
 * such change exists in this repository's history: every signature change so far
 * renamed the parameter too - `20260901001400`'s `p_expected_lap_count integer`
 * became `20260903001500`'s `p_expected_laps jsonb` - so a database holding the
 * older one answers `PGRST202` for a probe sending the newer name, and that drift
 * IS caught. Closing the type case would mean comparing signatures rather than
 * names, which is a different check; nothing here does it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

/**
 * PostgREST's code for "no function of that name and parameter set is in the
 * schema cache". The one code that means drift; any OTHER PostgREST answer -
 * `22P02`, `42501`, a success - means the Data API resolved the function, which
 * is all this check asks. An answer that is not PostgREST's at all is a third
 * case, and `DataApiUnreachableError` below is it.
 */
export const RPC_NOT_IN_SCHEMA_CACHE = 'PGRST202';

/**
 * A value no `uuid` and no `integer` parses. Every contract below without a
 * `guard` puts it in at least one such parameter, which is what keeps the probe
 * from executing; `schema-contract.test.ts` fails if one stops doing so.
 */
export const UNCOERCIBLE_PROBE_VALUE = 'trackday-tuner-health-probe';

/**
 * Raised when a probe came back with no PostgREST error code: the request never
 * reached the Data API (a paused project, DNS, TLS), or something in front of it
 * answered with a body PostgREST did not write.
 *
 * `postgrest-js` resolves both of those as an ordinary error rather than
 * rejecting - `code: ''` for a transport failure, no `code` at all for a body it
 * could not parse - so neither is `PGRST202`, and treating "not PGRST202" as
 * proof of resolution would report a schema in step that nothing had answered
 * for. An empty result from `findUnresolvableRpcs` has to mean every contract
 * was asked AND every one resolved.
 *
 * The name is what `/api/health` publishes as the check detail; it carries no
 * table name and no rider data.
 */
export class DataApiUnreachableError extends Error {
  constructor(names: readonly string[]) {
    super(`The Data API did not answer for: ${names.join(', ')}.`);
    this.name = 'DataApiUnreachableError';
  }
}

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
  /**
   * How a probe that CAN be coerced is kept from running the body. A function
   * whose parameters are all text and json has nothing to poison, so the probe
   * resolves and executes - and the only acceptable body to execute is one
   * whose first statement refuses a caller with no rider, which the service
   * role the health check runs as never has. `signed_in_rider` says the
   * probe earns `42501` before any read or write, which
   * `tests/db/service-book-transfer.spec.ts` proves against a live handover.
   */
  guard?: 'signed_in_rider';
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
  guard?: RpcContract['guard'],
): RpcContract {
  return guard ? { name, probe, guard } : { name, probe };
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
  contract('create_session_with_laps', {
    p_session_id: UNCOERCIBLE_PROBE_VALUE,
    p_session: {},
    p_laps: [],
    p_environment: null,
  }),
  contract('delete_auto_created_track_if_unused', {
    p_track_id: UNCOERCIBLE_PROBE_VALUE,
  }),
  contract('delete_vehicle_if_sessions_unchanged', {
    p_vehicle_id: UNCOERCIBLE_PROBE_VALUE,
    p_expected_sessions: [],
  }),
  contract('reserve_service_attachment', {
    p_book_id: UNCOERCIBLE_PROBE_VALUE,
    p_entry_id: null,
    p_kind: 'receipt',
    p_mime: 'image/jpeg',
    p_bytes: 1,
  }),
  contract('confirm_service_attachment', {
    p_attachment_id: UNCOERCIBLE_PROBE_VALUE,
  }),
  contract('service_attachment_orphan_objects', {
    p_limit: UNCOERCIBLE_PROBE_VALUE,
  }),
  contract('save_service_entry', {
    p_book_id: UNCOERCIBLE_PROBE_VALUE,
    p_entry_id: null,
    p_entry: {},
    p_items: [],
    p_parts: null,
  }),
  contract('open_service_book_share', {
    p_token_hash: 'probe',
    p_count_view: false,
    p_limit: UNCOERCIBLE_PROBE_VALUE,
    p_window_seconds: UNCOERCIBLE_PROBE_VALUE,
  }),
  contract('create_service_book_transfer', {
    p_book_id: UNCOERCIBLE_PROBE_VALUE,
    p_to_email: 'probe',
    p_token_hash: 'probe',
    p_handover_hours: null,
    p_handover_distance: null,
    p_time_zone: null,
  }),
  contract('cancel_service_book_transfer', {
    p_transfer_id: UNCOERCIBLE_PROBE_VALUE,
  }),
  contract('consume_beta_rate_limit', {
    p_key_hash: UNCOERCIBLE_PROBE_VALUE,
    p_limit: UNCOERCIBLE_PROBE_VALUE,
    p_window_seconds: UNCOERCIBLE_PROBE_VALUE,
  }),
  contract('describe_service_book_transfer', {
    p_token: 'probe',
    p_viewer_id: UNCOERCIBLE_PROBE_VALUE,
    p_viewer_email: null,
  }),
  // Both take the raw link token and a json: nothing to poison. Each opens by
  // refusing a caller with no rider (42501), which the service role is.
  contract('prepare_service_book_transfer_accept', { p_token: 'probe' }, 'signed_in_rider'),
  contract('accept_service_book_transfer', { p_token: 'probe', p_photo_urls: {} }, 'signed_in_rider'),
];

/**
 * The names of the RPCs the Data API could not resolve, in contract order.
 *
 * Throws `DataApiUnreachableError` when any probe got no PostgREST-shaped
 * answer, so an empty list means every contract was asked and every one
 * resolved rather than that nothing answered.
 */
export async function findUnresolvableRpcs(
  client: Pick<SupabaseClient, 'rpc'>,
): Promise<string[]> {
  const answers = await Promise.all(
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
      return { name: required.name, error };
    }),
  );

  const unanswered = answers.filter(({ error }) => error !== null && !error.code);
  if (unanswered.length > 0) {
    throw new DataApiUnreachableError(unanswered.map(({ name }) => name));
  }

  return answers
    .filter(({ error }) => error?.code === RPC_NOT_IN_SCHEMA_CACHE)
    .map(({ name }) => name);
}
