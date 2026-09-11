import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// The generator is plain JS for the same reason the RAG harness is: it runs
// under node with no build step. There are no types and `allowJs` is off, so
// the import carries a directive on the module-specifier line.
// @ts-expect-error - see above.
import { AUDIT_SQL_PATH, MIGRATION_PROBES, buildAuditSql, migrationNames } from '@/scripts/build-migration-audit.mjs';

/**
 * `scripts/sql/audit-migrations-against-database.sql` is what an operator runs
 * mid-incident to decide whether a hosted database has the schema its code
 * expects. Its worst failure is answering "every migration present" while one
 * it never knew about is missing - the audit reporting the exact condition it
 * exists to detect as healthy.
 *
 * A hand-kept list of rows reaches that state on the next migration, so the
 * list is DERIVED from `supabase/migrations/`. What follows runs the derivation
 * rather than reading the emitted SQL for strings: over directories whose
 * contents this file controls, and against the committed artifact, which is
 * compared to a fresh generation byte for byte.
 */

const FIXTURES = path.resolve(__dirname, '../fixtures/migration-audit');

/** Probes for the committed fixtures. `20260103000000` is deliberately absent. */
const FIXTURE_PROBES = {
  '20260101000000_fixture_creates_a_table': {
    kind: 'table',
    object: 'public.fixture_widgets',
    present: "to_regclass('public.fixture_widgets') is not null",
  },
  '20260102000000_fixture_creates_a_function': {
    kind: 'function',
    object: 'public.fixture_widget_count()',
    present: "to_regprocedure('public.fixture_widget_count()') is not null",
  },
  '20260103000000_fixture_with_no_probe': {
    kind: 'table',
    object: 'public.fixture_unprobed',
    present: "to_regclass('public.fixture_unprobed') is not null",
  },
};

function probesExcept(...omit: string[]) {
  return Object.fromEntries(
    Object.entries(FIXTURE_PROBES).filter(([name]) => !omit.includes(name)),
  );
}

/** The `(n, '<migration>', ...` rows the emitted query actually declares. */
function emittedMigrations(sql: string): string[] {
  return [...sql.matchAll(/^ {2}\(\d+, '([^']+)',/gm)].map((match) => match[1]);
}

describe('migration audit generation', () => {
  it('emits one row per migration file, in applied order', () => {
    const sql = buildAuditSql({ migrationsDir: FIXTURES, probes: FIXTURE_PROBES });

    expect(emittedMigrations(sql)).toEqual([
      '20260101000000_fixture_creates_a_table',
      '20260102000000_fixture_creates_a_function',
      '20260103000000_fixture_with_no_probe',
    ]);
  });

  // The derivation moving with the directory is the whole claim, so add a
  // migration to a directory and watch the query grow. A row count that came
  // from the probe map instead would not move here.
  it('grows by a row when a migration is added to the directory', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tt-migration-audit-'));
    writeFileSync(path.join(dir, '20260101000000_first.sql'), 'select 1;\n');
    const probes: Record<string, unknown> = {
      '20260101000000_first': {
        kind: 'table',
        object: 'public.first',
        present: "to_regclass('public.first') is not null",
      },
    };

    const before = emittedMigrations(buildAuditSql({ migrationsDir: dir, probes }));

    writeFileSync(path.join(dir, '20260202000000_second.sql'), 'select 1;\n');
    probes['20260202000000_second'] = {
      kind: 'table',
      object: 'public.second',
      present: "to_regclass('public.second') is not null",
    };
    const after = emittedMigrations(buildAuditSql({ migrationsDir: dir, probes }));

    expect(before).toEqual(['20260101000000_first']);
    expect(after).toEqual(['20260101000000_first', '20260202000000_second']);
  });

  // THE COUPLING. An eighteenth migration with no probe entry must stop the
  // generator and name itself, because the alternative is a query that silently
  // audits sixteen of seventeen and reports every one of them present.
  it('refuses to generate when a migration has no probe, and names it', () => {
    expect(() =>
      buildAuditSql({
        migrationsDir: FIXTURES,
        probes: probesExcept('20260103000000_fixture_with_no_probe'),
      }),
    ).toThrow(/20260103000000_fixture_with_no_probe/);
  });

  it('refuses to generate when a probe names no migration file', () => {
    expect(() =>
      buildAuditSql({
        migrationsDir: FIXTURES,
        probes: {
          ...FIXTURE_PROBES,
          '20991231000000_never_written': FIXTURE_PROBES['20260101000000_fixture_creates_a_table'],
        },
      }),
    ).toThrow(/20991231000000_never_written/);
  });

  // An empty directory would emit a syntactically fine query that audits
  // nothing, finds no MISSING row, and so reads as a database in step.
  it('refuses to generate from a directory holding no migrations', () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'tt-migration-audit-empty-'));

    expect(() => buildAuditSql({ migrationsDir: empty, probes: {} })).toThrow(/No migrations found/);
  });

  // The drift check: the committed .sql is a generated artifact, so it is a byte
  // contract with its generator and a regeneration cannot be forgotten.
  it('has the committed SQL matching a fresh generation', () => {
    expect(readFileSync(AUDIT_SQL_PATH as string, 'utf8')).toBe(buildAuditSql());
  });

  it('covers every migration in the repository', () => {
    const names = migrationNames() as string[];

    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(MIGRATION_PROBES as Record<string, unknown>).sort()).toEqual(
      [...names].sort(),
    );
  });
});
