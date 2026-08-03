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
//   - a schema-wide grant of execute that reverses a deliberate per-function
//     `revoke`. Tables are contained by RLS; a `security definer` function is not,
//     because it runs as its owner and bypasses every policy, so for those the
//     grant is the access control and it belongs to the migration that creates
//     the function
//
// WHAT IT DOES NOT CATCH, because a guard assumed to cover more than it does is
// worse than none: whether a migration actually runs. This reads SQL as text, so a
// syntax error, a column type the app cannot use, an RLS policy that denies the
// wrong rows, or a table whose columns drifted from types/supabase.ts all pass
// here. Only building a database proves those: `supabase start` from a clean state
// and then exercising the app against it. Nor does it check that a function is
// executable by the role that calls it: it can see a grant taken away, not one
// that was never written. Nor does it see a missing table named anywhere other
// than a foreign key: a policy or function body reading `from public.X` or
// `insert into public.X` aborts `supabase start` exactly the way the missing
// profiles table did, and passes here, because matching those would also fire on
// every ordinary statement against a table that does exist and a guard that
// cries wolf gets skipped. It also says nothing about the hosted project, whose
// applied history is recorded remotely and cannot be read from these files at
// all - see the migration notes in CLAUDE.md.

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations',
);

interface Migration {
  file: string;
  sql: string;
}

// Comments are stripped before anything is matched. These files explain
// themselves at length, and prose naming a table would otherwise register it as
// created - masking the one bug this exists to catch. No migration puts `--` or
// `/* */` inside a string literal or a function body, so removing them by text
// is safe.
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function loadMigrations(): Migration[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      sql: stripComments(readFileSync(path.join(migrationsDir, file), 'utf8')),
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

// `[^;]*` keeps each of these inside a single statement.
const REVOKE_ON_FUNCTION = /revoke\s+[^;]*\son\s+function\s+public\.(\w+)/gi;
const SCHEMA_WIDE_EXECUTE_GRANT =
  /grant\s+[^;]*\son\s+all\s+(?:routines|functions)\s+in\s+schema\s+public\s+to\s+[^;]*\b(?:anon|authenticated)\b/i;
const DEFAULT_EXECUTE_GRANT =
  /alter\s+default\s+privileges\s[^;]*\bgrant\s+[^;]*\son\s+(?:routines|functions)\s+to\s+[^;]*\b(?:anon|authenticated)\b/i;

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
    const roles = ['anon', 'authenticated', 'service_role'];

    // Each role is looked for on its own inside the grant's role list, so
    // `to service_role, authenticated, anon` passes like any other ordering of
    // the same statement. Reported as the roles missing from the closest
    // matching statement, so a failure names what is absent rather than only
    // saying the pattern did not match.
    function rolesMissingFrom(pattern: RegExp): string[] {
      const shortfalls = matchAll(sql, pattern)
        .map((targets) => roles.filter((role) => !new RegExp(`\\b${role}\\b`).test(targets)))
        .sort((a, b) => a.length - b.length);

      return shortfalls[0] ?? roles;
    }

    // A grant naming all three roles at once, in any order, on tables.
    expect(
      rolesMissingFrom(/grant\s+[^;]*\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+([^;]*)/g),
    ).toEqual([]);
    // Without this, every migration added after the grant file is invisible again.
    expect(
      rolesMissingFrom(
        /alter\s+default\s+privileges\s+in\s+schema\s+public\s+grant\s+[^;]*\s+on\s+tables\s+to\s+([^;]*)/g,
      ),
    ).toEqual([]);
    expect(sql).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+[^;]*\banon\b/);
  });

  it('leaves execute on a function to the migration that creates it', () => {
    const revoked = new Set<string>();
    const violations: string[] = [];

    for (const { file, sql } of migrations) {
      if (SCHEMA_WIDE_EXECUTE_GRANT.test(sql) && revoked.size > 0) {
        violations.push(
          `${file}: grant on all routines re-exposes ${[...revoked].sort().join(', ')}`,
        );
      }
      if (DEFAULT_EXECUTE_GRANT.test(sql)) {
        violations.push(`${file}: alter default privileges exposes every function added after it`);
      }
      for (const fn of matchAll(sql, REVOKE_ON_FUNCTION)) revoked.add(fn);
    }

    expect(violations).toEqual([]);
    // The routines default privilege, pinned here so a later migration cannot
    // quietly drop it. It is a declaration of intent and not an enforcement: it
    // is recorded correctly in pg_default_acl, but a function created afterwards
    // on a rebuilt stack still comes out with a null proacl, which is Postgres's
    // built-in execute to public. A new function is world-executable until its
    // own migration revokes it.
    expect(migrations.map(({ sql }) => sql).join('\n').toLowerCase()).toMatch(
      /alter\s+default\s+privileges\s+in\s+schema\s+public\s+revoke\s+(?:execute|all)\s+on\s+(?:routines|functions)\s+from\s+public/,
    );
  });
});
