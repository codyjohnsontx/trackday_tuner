/**
 * Generates `scripts/sql/audit-migrations-against-database.sql` from whatever is
 * in `supabase/migrations/`.
 *
 * The audit is read mid-incident by someone deciding whether a hosted database
 * has the schema its code expects, so its worst possible failure is reporting
 * every row `present` while a migration it does not know about is missing. That
 * is the same defect the audit exists to detect, wearing the diagnostic. A
 * hand-kept list gets there on the next migration and says nothing while it
 * does, so THE LIST IS DERIVED FROM THE DIRECTORY and this file is the only
 * place a migration can be added to it.
 *
 * What cannot be derived is the probe: `20260719001100` only grants, and
 * `20260824001300` only writes storage policies, so neither creates an object a
 * name lookup could find. `MIGRATION_PROBES` therefore stays explicit - and the
 * coupling is that generation FAILS when a migration has no entry, or an entry
 * names no migration. An eighteenth migration hits that on `npm run db:audit`,
 * and `tests/unit/migration-audit-generation.test.ts` hits it in CI - that suite
 * also compares the committed file against a fresh generation, so a forgotten
 * regeneration is a red check rather than something anyone has to remember.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(HERE, '..');
export const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
export const AUDIT_SQL_PATH = path.join(ROOT, 'scripts/sql/audit-migrations-against-database.sql');

/**
 * The md5 of a function body as Postgres stores it in `pg_proc.prosrc`: the text
 * between the `$$` quotes, byte for byte. A probe that compares
 * `md5(p.prosrc)` with this proves the installed definition IS the migration's,
 * where a name lookup or a substring only proves something by that name exists.
 * It reads `prosrc` rather than `pg_get_functiondef`, which Postgres re-renders
 * and so differs between versions. Without `functionName` the migration must
 * hold exactly one `as $$ ... $$;` body; with it, exactly one of its bodies
 * must belong to `create or replace function public.<functionName>(`.
 */
export function functionBodyMd5(migrationBasename, functionName, migrationsDir = MIGRATIONS_DIR) {
  const sql = readFileSync(path.join(migrationsDir, `${migrationBasename}.sql`), 'utf8');
  const bodies = [...sql.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)]
    .filter((match) => functionName === undefined || match[1] === functionName)
    .map((match) => match[2]);
  if (bodies.length !== 1) {
    const which = functionName === undefined ? 'function bodies' : `bodies for public.${functionName}`;
    throw new Error(`${migrationBasename}.sql has ${bodies.length} dollar-quoted ${which}; expected exactly one.`);
  }
  return createHash('md5').update(bodies[0], 'utf8').digest('hex');
}

/**
 * The md5 of a policy expression as `pg_policies` prints it, with the one
 * qualifier that depends on the reader's `search_path` taken out: Postgres
 * prints `public.vehicles` when `public` is not on the path and `vehicles` when
 * it is, and the SQL editor and a migration run disagree. Everything else in
 * the text is fixed by the policy. The probe and the runbook's verify query
 * apply the same `replace`, so both read one fingerprint on any path.
 */
export const SESSION_VEHICLE_OWNED_CHECK_MD5 = '7c9b3da91045db80e54e45052117e6e2';

const CREATE_SESSION_WITH_LAPS = "to_regprocedure('public.create_session_with_laps(uuid,jsonb,jsonb,jsonb)')";
const DELETE_AUTO_CREATED_TRACK = "to_regprocedure('public.delete_auto_created_track_if_unused(uuid)')";
const AUTO_CREATED_TRACK_IS_REFERENCED = "to_regprocedure('public.auto_created_track_is_referenced(uuid)')";
const RECORD_DELETED_SESSION = "to_regprocedure('public.record_deleted_session()')";

/**
 * The tombstone trigger, proved field by field rather than by name: on
 * `public.sessions`, calling `record_deleted_session()`, `tgtype` 9 (ROW = 1,
 * DELETE = 8, and neither the BEFORE nor the INSTEAD bit, so AFTER), enabled in
 * the ordinary way, with no WHEN clause and no arguments - and the only trigger
 * calling that function. A trigger that kept the name and fired per statement,
 * on another event or into another function writes no tombstone, and a replay
 * then recreates the session. `to_regclass` rather than a `::regclass` cast so a
 * database without `sessions` reads false instead of failing the whole query.
 * The runbook's verify query carries the same predicate;
 * tests/unit/hosted-session-ownership-runbook.test.ts holds the two together.
 */
export const SESSION_TOMBSTONE_TRIGGER_EXACT = [
  'exists (select 1 from pg_trigger t',
  "         where t.tgrelid = to_regclass('public.sessions')",
  "           and t.tgname = 'sessions_record_deleted'",
  `           and t.tgfoid = ${RECORD_DELETED_SESSION}`,
  '           and t.tgtype = 9',
  "           and t.tgenabled = 'O'",
  '           and t.tgnargs = 0',
  '           and t.tgqual is null',
  '           and not t.tgisinternal)',
  'and (select count(*) from pg_trigger t',
  `      where t.tgfoid = ${RECORD_DELETED_SESSION}) = 1`,
];

/**
 * Every policy on `sessions` and `deleted_sessions`, each matched on its whole
 * tuple - command, permissive, roles, `using` and `with check` - so a policy
 * whose name is right and whose command is not (`alter policy` cannot change a
 * command, so a hand-made `for all` survives the apply block) does not count.
 * `with check` is compared by SESSION_VEHICLE_OWNED_CHECK_MD5 for the reason
 * given there. It counts the matches; the total beside it counts every policy
 * on the two tables, because permissive policies are OR-ed and one more of
 * either kind reopens what the five close. Both read 5.
 */
export const SESSION_OWNERSHIP_POLICIES_EXACT = [
  '(select count(*) from pg_policies p',
  '   join (values',
  "     ('sessions', 'sessions: select own', 'SELECT', '(auth.uid() = user_id)', null),",
  `     ('sessions', 'sessions: insert own', 'INSERT', null, '${SESSION_VEHICLE_OWNED_CHECK_MD5}'),`,
  `     ('sessions', 'sessions: update own', 'UPDATE', '(auth.uid() = user_id)', '${SESSION_VEHICLE_OWNED_CHECK_MD5}'),`,
  "     ('sessions', 'sessions: delete own', 'DELETE', '(auth.uid() = user_id)', null),",
  "     ('deleted_sessions', 'deleted_sessions: select own', 'SELECT', '(auth.uid() = user_id)', null)",
  '   ) as e(tablename, policyname, cmd, qual, with_check_md5)',
  '     on e.tablename = p.tablename and e.policyname = p.policyname',
  "  where p.schemaname = 'public'",
  '    and p.cmd = e.cmd',
  "    and p.permissive = 'PERMISSIVE'",
  "    and p.roles = array['public']::name[]",
  '    and p.qual is not distinct from e.qual',
  "    and md5(replace(p.with_check, 'public.vehicles', 'vehicles')) is not distinct from e.with_check_md5)",
];

export const SESSION_OWNERSHIP_POLICIES_TOTAL = [
  '(select count(*) from pg_policies p',
  "  where p.schemaname = 'public' and p.tablename in ('sessions', 'deleted_sessions'))",
];

const indent = (lines, by) => lines.map((line) => `${' '.repeat(by)}${line}`);

/**
 * Migration basename (no `.sql`) -> the object that migration is the only thing
 * in this repository to create, and the read that answers whether it is there.
 *
 * `present` is one SQL expression; an array is joined as lines and indented
 * under the row. `note` is emitted as a SQL comment above the row.
 */
export const MIGRATION_PROBES = {
  '20260223000000_init_baseline_schema': {
    kind: 'table',
    object: 'public.sessions',
    present: "to_regclass('public.sessions') is not null",
  },
  '20260224000000_add_sag_entries': {
    kind: 'table',
    object: 'public.sag_entries',
    present: "to_regclass('public.sag_entries') is not null",
  },
  '20260224000100_add_stripe_profile_fields': {
    kind: 'column',
    object: 'public.profiles.stripe_customer_id',
    present: [
      'exists (select 1 from information_schema.columns',
      "        where table_schema='public' and table_name='profiles'",
      "          and column_name='stripe_customer_id')",
    ],
  },
  '20260228000200_add_session_module_metadata': {
    kind: 'column',
    object: 'public.sessions.enabled_modules',
    present: [
      'exists (select 1 from information_schema.columns',
      "        where table_schema='public' and table_name='sessions'",
      "          and column_name='enabled_modules')",
    ],
  },
  '20260420000300_add_ai_requests': {
    kind: 'table',
    object: 'public.ai_requests',
    present: "to_regclass('public.ai_requests') is not null",
  },
  '20260422000400_add_adaptive_race_engineer': {
    kind: 'table',
    object: 'public.ai_recommendations',
    present: "to_regclass('public.ai_recommendations') is not null",
  },
  '20260424000500_add_ai_request_observability': {
    kind: 'index',
    object: 'ai_requests_user_fingerprint_created_idx',
    present: "to_regclass('public.ai_requests_user_fingerprint_created_idx') is not null",
  },
  '20260626000600_add_vehicle_baselines': {
    kind: 'table',
    object: 'public.vehicle_baselines',
    present: "to_regclass('public.vehicle_baselines') is not null",
  },
  '20260705000700_add_session_changes': {
    kind: 'table',
    object: 'public.session_changes',
    present: "to_regclass('public.session_changes') is not null",
  },
  '20260716000800_add_session_outcomes': {
    note: ['The reported defect. Nine arguments, in the order the route sends them.'],
    kind: 'function',
    object: 'public.save_session_outcome(uuid,uuid,uuid,uuid,text,smallint,text[],text,smallint)',
    present:
      "to_regprocedure('public.save_session_outcome(uuid,uuid,uuid,uuid,text,smallint,text[],text,smallint)') is not null",
  },
  '20260717000900_add_session_laps': {
    kind: 'table',
    object: 'public.session_laps',
    present: "to_regclass('public.session_laps') is not null",
  },
  '20260718001000_add_beta_foundation': {
    kind: 'table',
    object: 'public.beta_invites',
    present: "to_regclass('public.beta_invites') is not null",
  },
  '20260719001100_grant_data_api_access': {
    note: [
      'Grants, not objects, so it takes two halves. The insert on sessions is one',
      'this migration is the only thing in the repository to make, and without it',
      'the Data API answers `permission denied for table` on a project created',
      'today - one built before Supabase turned off `auto_expose_new_tables` gets',
      'it from the legacy defaults instead. The revoke is the other half:',
      '`authenticated` must NOT hold update on profiles, because RLS picks the row',
      'and cannot restrict the column, so that privilege is a rider setting their',
      'own `tier`. Testing only the revoke would read `present` on a database that',
      'never granted anything at all.',
      '',
      'The CASE is load-bearing rather than style. `has_table_privilege` RAISES on',
      'a table that does not exist, and Postgres does not promise to short-circuit',
      'AND - the docs send you to CASE when evaluation order matters. Without it,',
      'a database missing the baseline aborts this whole query on this row instead',
      'of printing the MISSING rows the operator came here to read, which is',
      'exactly the state the first row exists to report.',
    ],
    kind: 'grant',
    object: 'authenticated has insert on public.sessions and NO update on public.profiles',
    present: [
      "case when to_regclass('public.sessions') is null",
      "       or to_regclass('public.profiles') is null then false",
      "     else has_table_privilege('authenticated', 'public.sessions', 'insert')",
      "          and not has_table_privilege('authenticated', 'public.profiles', 'update')",
      'end',
    ],
  },
  '20260816001200_add_profile_on_auth_user_created': {
    kind: 'trigger',
    object: 'on_auth_user_created on auth.users',
    present: [
      'exists (select 1 from pg_trigger',
      "        where tgname='on_auth_user_created'",
      "          and tgrelid='auth.users'::regclass",
      '          and not tgisinternal)',
    ],
  },
  '20260824001300_add_vehicle_photos_storage_policies': {
    kind: 'policy',
    object: 'vehicle-photos: insert own (storage.objects)',
    present: [
      'exists (select 1 from pg_policies',
      "        where schemaname='storage' and tablename='objects'",
      "          and policyname='vehicle-photos: insert own')",
    ],
  },
  '20260901001400_guard_replace_session_laps_against_stale_reads': {
    note: [
      '20260901001400 shipped replace_session_laps(...,integer) and 20260903001500',
      'replaced it with (...,jsonb), dropping both earlier signatures. So the',
      'integer form present means 1400 applied and 1500 did not; the jsonb form',
      'present means 1500 applied, which implies 1400 did too.',
    ],
    kind: 'function',
    object: 'public.replace_session_laps(uuid,uuid,jsonb,integer) OR its 1500 replacement',
    present: [
      "to_regprocedure('public.replace_session_laps(uuid,uuid,jsonb,integer)') is not null",
      "or to_regprocedure('public.replace_session_laps(uuid,uuid,jsonb,jsonb)') is not null",
    ],
  },
  '20260903001500_replace_session_laps_compares_lap_content': {
    kind: 'function',
    object: 'public.session_laps_identity(jsonb)',
    present: [
      "to_regprocedure('public.replace_session_laps(uuid,uuid,jsonb,jsonb)') is not null",
      "and to_regprocedure('public.session_laps_identity(jsonb)') is not null",
    ],
  },
  '20260916001600_seed_north_america_tracks': {
    kind: 'table',
    object: 'public.track_aliases',
    // Catalog reads only. Whether the seeded ROWS arrived cannot be asked here
    // without naming `tracks.slug`, and on a database missing this migration that
    // column does not exist - so the reference would fail the whole audit query
    // rather than report this one row absent. The three objects below are
    // created in the same file as the inserts.
    note: ['The seeded rows themselves: select count(*) from public.tracks where slug is not null (50).'],
    present: [
      "to_regclass('public.track_aliases') is not null",
      "and to_regclass('public.track_layouts') is not null",
      'and exists (select 1 from information_schema.columns',
      "        where table_schema='public' and table_name='sessions'",
      "          and column_name='layout_id')",
    ],
  },
  '20260924001700_add_ai_request_text': {
    note: [
      'The table alone is not the promise: text is only deleted at 90 days if the',
      'purge job is scheduled, and a hosted project without pg_cron takes the',
      'table and silently keeps every row. cron.job is read only once pg_cron is',
      'known to be installed, and through query_to_xml, which plans its query at',
      'run time: naming cron.job directly fails the WHOLE audit at parse time on',
      'a database without pg_cron, which no CASE can prevent.',
      'Whether the job has actually RUN is not answerable here: read',
      'cron.job_run_details, or /api/health, which fails ai_text_retention on a',
      'row more than 36 hours past its retain_until, or on an ai_requests preview',
      'still set more than 90 days and 36 hours after its created_at.',
    ],
    kind: 'cron job',
    object: 'public.ai_request_text + cron job purge-expired-ai-request-text',
    present: [
      "to_regclass('public.ai_request_text') is not null",
      "and case when to_regclass('cron.job') is null then false",
      "         else (xpath('count(/table/row)', query_to_xml(",
      "                 'select jobname from cron.job where jobname = ''purge-expired-ai-request-text''',",
      "                 false, false, '')))[1]::text::int > 0",
      '    end',
    ],
  },
  '20260925001800_question_retention_opt_in_for_everyone': {
    note: [
      'Only the column default is read, through the catalog: naming the column',
      'fails the whole audit on a database missing 20260924001700. Whether every',
      'existing row was backfilled: select count(*) from public.profiles',
      'where not ai_question_retention_requires_opt_in (0).',
    ],
    kind: 'column default',
    object: 'public.profiles.ai_question_retention_requires_opt_in default true',
    present: [
      'exists (select 1 from information_schema.columns',
      "        where table_schema='public' and table_name='profiles'",
      "          and column_name='ai_question_retention_requires_opt_in'",
      "          and column_default = 'true')",
    ],
  },
  '20260926001900_guard_rider_text_capture_at_write': {
    kind: 'trigger',
    object: 'ai_request_text_enforce_keep_rule + ai_requests_enforce_keep_rule',
    present: [
      '(select count(*) from pg_trigger',
      "  where tgname in ('ai_request_text_enforce_keep_rule', 'ai_requests_enforce_keep_rule')",
      '    and not tgisinternal) = 2',
    ],
  },
  '20260926002000_add_session_photos': {
    // The bucket is config.toml's, not this migration's, so it is a note rather
    // than part of `present`: a CLI-built project that skipped `seed buckets`
    // has every object this file creates and still refuses the upload.
    //
    // The policies are compared, not counted by name: four policies called
    // `session-photos: ... own` whose predicate dropped `auth.uid()` would let any
    // rider overwrite any photo and still count four. Command, role, and the
    // `using` / `with check` text exactly as Postgres prints the migration's
    // predicate back - the same comparison as the runbook's verify query.
    note: ["The bucket itself: select public from storage.buckets where id = 'session-photos' (true)."],
    kind: 'column + policies',
    object: 'public.sessions.photo_url + 4 owner-scoped session-photos policies (storage.objects)',
    present: [
      'exists (select 1 from information_schema.columns',
      "        where table_schema='public' and table_name='sessions'",
      "          and column_name='photo_url')",
      'and (select count(*) from pg_policies p',
      '     join (values',
      "       ('session-photos: select own', 'SELECT', true, false),",
      "       ('session-photos: insert own', 'INSERT', false, true),",
      "       ('session-photos: update own', 'UPDATE', true, true),",
      "       ('session-photos: delete own', 'DELETE', true, false)",
      '     ) as e(policyname, cmd, has_using, has_check) using (policyname)',
      "     where p.schemaname='storage' and p.tablename='objects'",
      "       and p.cmd = e.cmd and p.permissive = 'PERMISSIVE'",
      "       and p.roles = array['authenticated']::name[]",
      '       and p.qual is not distinct from case when e.has_using',
      "         then '((bucket_id = ''session-photos''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))' end",
      '       and p.with_check is not distinct from case when e.has_check',
      "         then '((bucket_id = ''session-photos''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))' end) = 4",
    ],
  },
  '20260926002100_delete_vehicle_if_sessions_unchanged': {
    kind: 'function',
    object: 'public.delete_vehicle_if_sessions_unchanged(uuid,jsonb)',
    present: "to_regprocedure('public.delete_vehicle_if_sessions_unchanged(uuid,jsonb)') is not null",
  },
  '20260927002000_add_ai_replay_export_view': {
    kind: 'view',
    object: 'public.ai_replay_export',
    present: "to_regclass('public.ai_replay_export') is not null",
  },
  '20260927002200_add_create_session_with_laps': {
    note: [
      'The function is create or replace, so an older or hand-edited copy is still',
      'there by name. Only the body fingerprint says the installed definition is',
      "this migration's; the other three read the security and grants it sets.",
      '20260928002300 replaces the body, so its fingerprint is accepted here too,',
      'as the 1400 row accepts its 1500 replacement.',
    ],
    kind: 'function',
    object: 'public.create_session_with_laps(uuid,jsonb,jsonb,jsonb)',
    present: [
      `${CREATE_SESSION_WITH_LAPS} is not null`,
      '     and (select md5(p.prosrc) in (' +
        `'${functionBodyMd5('20260927002200_add_create_session_with_laps')}', ` +
        `'${functionBodyMd5('20260928002300_session_vehicle_ownership_and_deleted_sessions', 'create_session_with_laps')}')`,
      '            and not p.prosecdef',
      "            and p.proconfig = array['search_path=\"\"']",
      "            and has_function_privilege('authenticated', p.oid, 'execute')",
      "            and not has_function_privilege('anon', p.oid, 'execute')",
      `          from pg_proc p where p.oid = ${CREATE_SESSION_WITH_LAPS})`,
    ],
  },
  '20260928002300_session_vehicle_ownership_and_deleted_sessions': {
    note: [
      'Three changes, each read by what makes it true rather than by name: the',
      'create function by its body, the trigger function by its body and its',
      'locked execute, the trigger by its table, timing, event, level and',
      'function (SESSION_TOMBSTONE_TRIGGER_EXACT), the tombstone table by RLS and',
      'its select-only rider grant, and every policy on sessions and',
      'deleted_sessions by its whole tuple, with no other policy on either table',
      '(SESSION_OWNERSHIP_POLICIES_EXACT; permissive policies are OR-ed, so one',
      'more reopens what the five close). All in scripts/build-migration-audit.mjs.',
      'The CASE keeps has_table_privilege off a table that is not there, as in',
      'the 1100 row.',
    ],
    kind: 'function + trigger + table + policies',
    object: 'create_session_with_laps cap and tombstones, deleted_sessions, sessions vehicle-owned policies',
    present: [
      `${CREATE_SESSION_WITH_LAPS} is not null`,
      '     and (select md5(p.prosrc) = ' +
        `'${functionBodyMd5('20260928002300_session_vehicle_ownership_and_deleted_sessions', 'create_session_with_laps')}'`,
      `          from pg_proc p where p.oid = ${CREATE_SESSION_WITH_LAPS})`,
      `     and ${RECORD_DELETED_SESSION} is not null`,
      '     and (select md5(p.prosrc) = ' +
        `'${functionBodyMd5('20260928002300_session_vehicle_ownership_and_deleted_sessions', 'record_deleted_session')}'`,
      '            and p.prosecdef',
      "            and p.proconfig = array['search_path=\"\"']",
      "            and not has_function_privilege('authenticated', p.oid, 'execute')",
      "            and not has_function_privilege('anon', p.oid, 'execute')",
      `          from pg_proc p where p.oid = ${RECORD_DELETED_SESSION})`,
      ...indent(SESSION_TOMBSTONE_TRIGGER_EXACT, 5).map((line, index) => (index === 0 ? `     and ${line.trimStart()}` : line)),
      "     and case when to_regclass('public.deleted_sessions') is null then false",
      "              else (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.deleted_sessions'))",
      "                   and has_table_privilege('authenticated', 'public.deleted_sessions', 'select')",
      "                   and not has_table_privilege('authenticated', 'public.deleted_sessions', 'insert, update, delete')",
      "                   and not has_table_privilege('anon', 'public.deleted_sessions', 'select, insert, update, delete')",
      '         end',
      ...indent([...SESSION_OWNERSHIP_POLICIES_EXACT.slice(0, -1), `${SESSION_OWNERSHIP_POLICIES_EXACT.at(-1)} = 5`], 9)
        .map((line, index) => (index === 0 ? `     and ${line.trimStart()}` : line)),
      ...indent([...SESSION_OWNERSHIP_POLICIES_TOTAL.slice(0, -1), `${SESSION_OWNERSHIP_POLICIES_TOTAL.at(-1)} = 5`], 9)
        .map((line, index) => (index === 0 ? `     and ${line.trimStart()}` : line)),
    ],
  },
  '20260930002400_delete_auto_created_track_if_unused': {
    note: [
      'Read by its body, so a hand-edited copy that deletes without the lock or',
      'the reference check reads MISSING, and by the invoker security, pinned',
      'search path and rider-only execute it is declared with.',
      '20261001002500 replaces the body, so its fingerprint is accepted here too.',
    ],
    kind: 'function',
    object: 'public.delete_auto_created_track_if_unused(uuid)',
    present: [
      `${DELETE_AUTO_CREATED_TRACK} is not null`,
      '     and (select md5(p.prosrc) in (' +
        `'${functionBodyMd5('20260930002400_delete_auto_created_track_if_unused')}', ` +
        `'${functionBodyMd5('20261001002500_auto_created_track_reference_check_sees_every_session', 'delete_auto_created_track_if_unused')}')`,
      '            and not p.prosecdef',
      "            and p.proconfig = array['search_path=\"\"']",
      "            and has_function_privilege('authenticated', p.oid, 'execute')",
      "            and not has_function_privilege('anon', p.oid, 'execute')",
      `          from pg_proc p where p.oid = ${DELETE_AUTO_CREATED_TRACK})`,
    ],
  },
  '20261001002500_auto_created_track_reference_check_sees_every_session': {
    note: [
      'Two functions, each by its body: the definer reference check with its',
      'empty search path and rider-only execute, and the take-back that calls it.',
    ],
    kind: 'function + function',
    object: 'public.auto_created_track_is_referenced(uuid), delete_auto_created_track_if_unused body',
    present: [
      `${AUTO_CREATED_TRACK_IS_REFERENCED} is not null`,
      '     and (select md5(p.prosrc) = ' +
        `'${functionBodyMd5('20261001002500_auto_created_track_reference_check_sees_every_session', 'auto_created_track_is_referenced')}'`,
      '            and p.prosecdef',
      "            and p.proconfig = array['search_path=\"\"']",
      "            and has_function_privilege('authenticated', p.oid, 'execute')",
      "            and not has_function_privilege('anon', p.oid, 'execute')",
      `          from pg_proc p where p.oid = ${AUTO_CREATED_TRACK_IS_REFERENCED})`,
      `     and ${DELETE_AUTO_CREATED_TRACK} is not null`,
      '     and (select md5(p.prosrc) = ' +
        `'${functionBodyMd5('20261001002500_auto_created_track_reference_check_sees_every_session', 'delete_auto_created_track_if_unused')}'`,
      `          from pg_proc p where p.oid = ${DELETE_AUTO_CREATED_TRACK})`,
    ],
  },
};

const HEADER = `-- GENERATED BY scripts/build-migration-audit.mjs - DO NOT EDIT BY HAND.
-- Regenerate with \`npm run db:audit\`. The unit suite fails when this file and
-- supabase/migrations/ disagree.
--
-- Which of supabase/migrations/ has this database actually got?
--
-- Read-only. Runs in the Supabase SQL editor against any project, including one
-- that was never built through the CLI and therefore has no
-- \`supabase_migrations.schema_migrations\` history for \`npm run db:status\` to
-- read. It asks the schema what is there rather than asking the CLI what it was
-- told, which is the only question that can be answered on this project today
-- (CLAUDE.md, "Database Migrations").
--
-- Each row names one migration and the object that migration is the only thing
-- to create. \`present = false\` means that migration has not been applied - or was
-- applied and then partially rolled back, which looks the same from here and
-- wants the same investigation.
--
-- WHAT THIS CANNOT TELL YOU: whether PostgREST can SEE what the schema has.
-- A stale schema cache leaves every row below \`true\` while the Data API answers
-- \`PGRST202 Could not find the function ... in the schema cache\` - byte-identical
-- to the answer it gives when the function is genuinely absent. If the rows are
-- all \`true\` and riders still get that error, the cache is the cause: reload it
-- with \`notify pgrst, 'reload schema';\` (see the runbook entry this ships with).`;

const FOOTER = `select ordinality as "#",
       migration,
       object_kind as kind,
       object_name as "expected object",
       case when present then 'present' else 'MISSING' end as status
from expected
order by ordinality;`;

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Migration basenames in the directory, without `.sql`, in applied order. */
export function migrationNames(migrationsDir = MIGRATIONS_DIR) {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => name.replace(/\.sql$/, ''));
}

export function buildAuditSql({ migrationsDir = MIGRATIONS_DIR, probes = MIGRATION_PROBES } = {}) {
  const names = migrationNames(migrationsDir);

  // An empty directory would otherwise emit a valid query that audits nothing
  // and reports no MISSING row, which reads exactly like a database in step.
  if (names.length === 0) {
    throw new Error(`No migrations found in ${migrationsDir}.`);
  }

  const unprobed = names.filter((name) => !probes[name]);
  if (unprobed.length > 0) {
    throw new Error(
      `No audit probe for: ${unprobed.join(', ')}.\n` +
        'Add an entry to MIGRATION_PROBES in scripts/build-migration-audit.mjs naming the ' +
        'object that migration is the only thing to create, then run `npm run db:audit`.',
    );
  }

  const orphaned = Object.keys(probes).filter((name) => !names.includes(name));
  if (orphaned.length > 0) {
    throw new Error(
      `Audit probe names no migration file: ${orphaned.join(', ')}.\n` +
        'Remove it from MIGRATION_PROBES, or correct the name to match a file in ' +
        `${migrationsDir}.`,
    );
  }

  const rows = names.map((name, index) => {
    const probe = probes[name];
    const present = Array.isArray(probe.present) ? probe.present : [probe.present];
    const lines = [];
    for (const line of probe.note ?? []) lines.push(`  --${line ? ` ${line}` : ''}`);
    lines.push(`  (${index + 1}, ${quote(name)}, ${quote(probe.kind)},`);
    lines.push(`      ${quote(probe.object)},`);
    present.forEach((line, position) => {
      const last = position === present.length - 1;
      lines.push(`      ${line}${last ? (index === names.length - 1 ? ')' : '),') : ''}`);
    });
    return lines.join('\n');
  });

  return [
    HEADER,
    'with expected(ordinality, migration, object_kind, object_name, present) as (values',
    ...rows,
    ')',
    FOOTER,
    '',
  ].join('\n');
}

function main() {
  let sql;
  try {
    sql = buildAuditSql();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
    return;
  }

  writeFileSync(AUDIT_SQL_PATH, sql);
  console.log(`Wrote ${AUDIT_SQL_PATH} (${migrationNames().length} migrations).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
