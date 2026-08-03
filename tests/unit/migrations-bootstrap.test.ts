import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the invariant that supabase/migrations/ can build a database from nothing.
//
// profiles, vehicles, tracks and sessions were originally created by hand in the
// Supabase dashboard, so no migration ever created them. Every migration written
// afterwards assumed they were there, and `supabase start` on a clean machine died
// on the second file with "relation public.profiles does not exist". Separately,
// nothing granted anything to anon, authenticated or service_role: the hosted
// project still carries Supabase's legacy auto-expose default privileges, but a
// project created today does not, so a fresh database applied every migration and
// then answered every PostgREST request with "permission denied for table ...".
// Both failures are invisible to anyone working against an already-populated
// database, which is exactly why they survived for months.
//
// WHAT IT CATCHES, stated exactly rather than as a claim of completeness:
//   - a migration that alters or references a public table no earlier migration
//     creates, which is the shape of the original bug
//   - a migration that installs a trigger using a function no earlier migration
//     defines
//   - the loss of the grants to anon / authenticated / service_role, or of the
//     `alter default privileges` that keeps later migrations exposed without
//     repeating those grants
//
// WHAT IT DOES NOT CATCH, because a guard assumed to cover more than it does is
// worse than none: whether a migration actually runs. This reads SQL as text, so a
// syntax error, a column type the app cannot use, an RLS policy that denies the
// wrong rows, or a table whose columns drifted from types/supabase.ts all pass
// here. Only building a database proves those: `supabase start` from a clean state
// and then exercising the app against it. It also says nothing about the hosted
// project, whose applied history is recorded remotely and cannot be read from these
// files at all - see the migration notes in CLAUDE.md.

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations',
);

interface Migration {
  file: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(path.join(migrationsDir, file), 'utf8'),
    }));
}

function matchAll(sql: string, pattern: RegExp): string[] {
  return Array.from(sql.matchAll(pattern), (match) => match[1]);
}

// `references auth.users(...)` is out of scope on purpose: auth owns that table and
// creates it before any of ours run.
const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi;
const ALTER_TABLE = /alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)/gi;
const REFERENCES = /references\s+public\.(\w+)/gi;
const CREATE_FUNCTION = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi;
const TRIGGER_FUNCTION = /execute\s+(?:function|procedure)\s+public\.(\w+)/gi;

const migrations = loadMigrations();

describe('supabase migrations bootstrap a database from nothing', () => {
  it('has migrations to check', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('creates every public table before any migration alters or references it', () => {
    const created = new Set<string>();
    const violations: string[] = [];

    for (const { file, sql } of migrations) {
      // Same-file creation counts: a migration may create a table and then add a
      // foreign key to it further down.
      for (const table of matchAll(sql, CREATE_TABLE)) created.add(table);

      for (const table of matchAll(sql, ALTER_TABLE)) {
        if (!created.has(table)) violations.push(`${file}: alter table public.${table}`);
      }
      for (const table of matchAll(sql, REFERENCES)) {
        if (!created.has(table)) violations.push(`${file}: references public.${table}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('creates the four tables the pre-migration app was built on', () => {
    const created = new Set(migrations.flatMap(({ sql }) => matchAll(sql, CREATE_TABLE)));

    for (const table of ['profiles', 'vehicles', 'tracks', 'sessions']) {
      expect(created).toContain(table);
    }
  });

  it('defines every trigger function before a trigger calls it', () => {
    const defined = new Set<string>();
    const violations: string[] = [];

    for (const { file, sql } of migrations) {
      for (const fn of matchAll(sql, CREATE_FUNCTION)) defined.add(fn);
      for (const fn of matchAll(sql, TRIGGER_FUNCTION)) {
        if (!defined.has(fn)) violations.push(`${file}: execute function public.${fn}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('grants the schema to the roles the application connects as', () => {
    const sql = migrations.map(({ sql: body }) => body).join('\n').toLowerCase();

    // A grant naming all three roles at once, in either order, on tables.
    expect(sql).toMatch(
      /grant\s+[^;]*\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+[^;]*\banon\b[^;]*\bauthenticated\b[^;]*\bservice_role\b/,
    );
    // Without this, every migration added after the grant file is invisible again.
    expect(sql).toMatch(
      /alter\s+default\s+privileges\s+in\s+schema\s+public\s+grant\s+[^;]*\s+on\s+tables\s+to\s+[^;]*\banon\b[^;]*\bauthenticated\b[^;]*\bservice_role\b/,
    );
    expect(sql).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+[^;]*\banon\b/);
  });
});
