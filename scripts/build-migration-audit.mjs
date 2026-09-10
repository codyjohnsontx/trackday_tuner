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
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(HERE, '..');
export const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
export const AUDIT_SQL_PATH = path.join(ROOT, 'scripts/sql/audit-migrations-against-database.sql');

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
