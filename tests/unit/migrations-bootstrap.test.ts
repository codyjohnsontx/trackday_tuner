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
//     the function. `anon`, `authenticated` and `public` all count as grant
//     targets: the first two are members of the third, so a grant to `public` is
//     the widest of the three and was the one this missed
//   - a `security definer` function whose own migration never decides whether
//     `public` may execute it. Postgres leaves proacl null on a function nobody
//     granted or revoked, and a null proacl is execute to public, so it ships
//     callable by an unauthenticated PostgREST request. The routines default
//     privilege does not close this - see the note on that expectation below.
//     However the declaration is written counts: Postgres's option list is
//     order-independent, so `security definer` after the body declares the same
//     function, and a name with no `public.` qualifier lands in public via
//     search_path and is the same function too
//
// WHAT IT DOES NOT CATCH, because a guard assumed to cover more than it does is
// worse than none: whether a migration actually runs. This reads SQL as text, so a
// syntax error, a column type the app cannot use, an RLS policy that denies the
// wrong rows, or a table whose columns drifted from types/supabase.ts all pass
// here. Only building a database proves those: `supabase start` from a clean state
// and then exercising the app against it. Nor does it check that a function is
// executable by the role that calls it: it reads the decision, not its effect, so
// a revoke naming the wrong role list or a grant to a role that never calls the
// function both pass. It finds a function body by its dollar-quote tag, which is
// what every function here uses; a body written between single quotes instead
// would have the first `;` inside it read as the end of the declaration, hiding
// any attribute that follows. Nor does it cover `security invoker` functions,
// which run as their caller and stay inside RLS, so for them execute is not the
// access control. 20260719001100 has since given the client-callable ones an
// explicit revoke anyway, so the reason to leave them alone is no longer that
// covering them would fail the repository wholesale. Two narrower reasons remain:
// `set_updated_at` has no revoke and needs none, because it is reached through
// the triggers that name it rather than called by a client; and 20260719001100
// revokes `save_session_outcome` and `record_race_engineer_memory_feedback` in a
// *later* migration than the one that creates them, which the same-migration rule
// below would flag. That rule is deliberately strict for `security definer`,
// where the gap between the two migrations is a window in which the function is
// world-executable, and it is why widening this check to every function would
// fail main today. Nor does it see a missing table named anywhere other
// than a foreign key: a policy or function body reading `from public.X` or
// `insert into public.X` aborts `supabase start` exactly the way the missing
// profiles table did, and passes here, because matching those would also fire on
// every ordinary statement against a table that does exist and a guard that
// cries wolf gets skipped. It also says nothing about the hosted project, whose
// applied history is recorded remotely and cannot be read from these files at
// all - see the migration notes in CLAUDE.md.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(testDir, '../../supabase/migrations');
const fixturesDir = path.resolve(testDir, '../fixtures/migration-guard');

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

// Deliberately wrong SQL, kept in tests/fixtures/migration-guard/ rather than in
// supabase/migrations/ so no Supabase command ever applies it. Order is the
// argument order, standing in for the filename order the real loader sorts by.
function loadFixtures(...files: string[]): Migration[] {
  return files.map((file) => ({
    file,
    sql: stripComments(readFileSync(path.join(fixturesDir, file), 'utf8')),
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
//
// `public` sits in the role list alongside anon and authenticated because it is the
// role the per-function revokes actually take execute away from, and because anon
// and authenticated are both members of it - a grant to public reaches strictly
// more callers than either of the other two spellings. Only the role list after
// `to` is searched for it, so the `in schema public` earlier in the same statement
// is not mistaken for a grant target.
const REVOKE_ON_FUNCTION = /revoke\s+[^;]*\son\s+function\s+(?:public\.)?(\w+)/gi;
const SCHEMA_WIDE_EXECUTE_GRANT =
  /grant\s+[^;]*\son\s+all\s+(?:routines|functions)\s+in\s+schema\s+public\s+to\s+[^;]*\b(?:anon|authenticated|public)\b/i;
const DEFAULT_EXECUTE_GRANT =
  /alter\s+default\s+privileges\s[^;]*\bgrant\s+[^;]*\son\s+(?:routines|functions)\s+to\s+[^;]*\b(?:anon|authenticated|public)\b/i;

// Each `create function` statement in full, from its name through the terminating
// `;`, with any dollar-quoted body taken out. `security definer` is then read off
// the whole declaration rather than off the body, and read wherever in the
// declaration it was written: Postgres's option list is order-independent, so
// `as $$ ... $$ language plpgsql security definer;` says exactly what putting
// `security definer` ahead of the body says, and a reader stopping at the opening
// `$` would see the second and miss the first. `set_updated_at` in 20260422000400
// already writes `language plpgsql` after its body, so this is the repository's
// own house style and not a hypothetical.
//
// `public.` is optional because an unqualified `create function f(...)` lands in
// public via search_path and is the same function. The lookahead stops a name in
// another schema from matching as the bare word before its dot, so
// `create function auth.f(...)` is not read as a function called `auth`.
const CREATE_FUNCTION_STATEMENT =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\b(?!\s*\.)/gi;

// A body opens on a dollar-quote tag - `$$`, or a named one like `$body$` - and
// closes on the identical tag, so a `;` inside it does not end the statement and
// the words `security definer` inside it are not an attribute.
const DOLLAR_TAG = /\$\w*\$/y;
const NEXT_FUNCTION = /create\s+(?:or\s+replace\s+)?function\b/iy;

function readStatement(sql: string, from: number): { text: string; end: number } {
  let text = '';
  let cursor = from;

  while (cursor < sql.length) {
    DOLLAR_TAG.lastIndex = cursor;
    const tag = DOLLAR_TAG.exec(sql);
    if (tag !== null) {
      const close = sql.indexOf(tag[0], cursor + tag[0].length);
      cursor = close === -1 ? sql.length : close + tag[0].length;
      text += ' ';
      continue;
    }

    // The terminator normally ends it; the next `create function` bounds one
    // written without a terminator at all.
    NEXT_FUNCTION.lastIndex = cursor;
    if (NEXT_FUNCTION.test(sql)) break;
    if (sql[cursor] === ';') {
      cursor += 1;
      break;
    }

    text += sql[cursor];
    cursor += 1;
  }

  return { text, end: cursor };
}

function functionStatements(sql: string): { name: string; statement: string }[] {
  const statements: { name: string; statement: string }[] = [];
  let cursor = 0;

  while (cursor < sql.length) {
    CREATE_FUNCTION_STATEMENT.lastIndex = cursor;
    const match = CREATE_FUNCTION_STATEMENT.exec(sql);
    if (match === null) break;

    const { text, end } = readStatement(sql, match.index + match[0].length);
    statements.push({ name: match[1], statement: text });
    // Resuming past the statement, body and all, so a `create function` written
    // inside a function body never starts a second one.
    cursor = end;
  }

  return statements;
}

// A statement naming this function and this role, in either direction. The arg
// list is optional because Postgres lets it be omitted when the name is unique,
// and the schema qualifier is optional for the same reason it is above: a
// migration that creates a function unqualified revokes on it unqualified too.
function privilegeStatement(verb: 'revoke' | 'grant', fn: string, preposition: string): RegExp {
  return new RegExp(
    `${verb}\\s+[^;]*\\son\\s+function\\s+(?:public\\.)?${fn}\\b(?:\\s*\\([^)]*\\))?\\s+${preposition}\\s+([^;]+)`,
    'i',
  );
}

function namesPublic(roleList: string | undefined): boolean {
  return roleList !== undefined && /\bpublic\b/i.test(roleList);
}

// A `security definer` function whose own migration never says whether `public`
// may execute it. Postgres leaves proacl null on a function nobody granted or
// revoked, and a null proacl is execute to public, so the function ships callable
// by an unauthenticated PostgREST caller while running as its owner and bypassing
// every RLS policy. The routines default privilege in 20260719001100 does not
// reach it - that was measured, not reasoned about, and is written up in CLAUDE.md.
//
// The decision, not the lockdown, is what is required. Either spelling passes:
//   revoke ... on function public.f(...) from public, ...   -- not callable by all
//   grant execute on function public.f(...) to public       -- callable by all, on purpose
// Both name `public`, which is the only role that settles it: `anon` and
// `authenticated` are members of public, so revoking from them by name while
// public still holds execute changes nothing.
function definerFunctionsWithoutAnExecuteDecision(migrations: Migration[]): string[] {
  const violations: string[] = [];

  for (const { file, sql } of migrations) {
    for (const { name, statement } of functionStatements(sql)) {
      if (!/security\s+definer/i.test(statement)) continue;

      const revokedFromPublic = namesPublic(sql.match(privilegeStatement('revoke', name, 'from'))?.[1]);
      const grantedToPublic = namesPublic(sql.match(privilegeStatement('grant', name, 'to'))?.[1]);
      if (revokedFromPublic || grantedToPublic) continue;

      violations.push(
        `${file}: security definer function public.${name} never says whether public may execute it`,
      );
    }
  }

  return violations;
}

// A grant of execute written across the whole schema, which undoes per-function
// revokes wholesale and names none of the functions it re-exposes.
function schemaWideExecuteGrants(migrations: Migration[]): string[] {
  const revoked = new Set<string>();
  const violations: string[] = [];

  for (const { file, sql } of migrations) {
    // This file's own revokes are collected before its grants are judged.
    // Collecting them afterwards missed the case where one migration revokes
    // execute on its own function and then issues a schema-wide grant that
    // undoes it: `revoked` was still empty at the check, so the file passed.
    // The cost is that a file granting broadly and only then revoking, which
    // is safe because the revoke runs last, is flagged too. No migration here
    // is written that way, and over-reporting a schema-wide execute grant is
    // the safe direction to err in.
    for (const fn of matchAll(sql, REVOKE_ON_FUNCTION)) revoked.add(fn);

    if (SCHEMA_WIDE_EXECUTE_GRANT.test(sql) && revoked.size > 0) {
      violations.push(
        `${file}: grant on all routines re-exposes ${[...revoked].sort().join(', ')}`,
      );
    }
    if (DEFAULT_EXECUTE_GRANT.test(sql)) {
      violations.push(`${file}: alter default privileges exposes every function added after it`);
    }
  }

  return violations;
}

// The whole execute invariant, run as one thing so the fixture tests below and the
// run against supabase/migrations/ exercise the same entry point.
function executeViolations(migrations: Migration[]): string[] {
  return [
    ...definerFunctionsWithoutAnExecuteDecision(migrations),
    ...schemaWideExecuteGrants(migrations),
  ];
}

// The trigger that gives public.profiles a writer, and the function it calls.
// `[^;]*?` keeps the search inside the one CREATE TRIGGER statement, so a trigger
// on some other table cannot lend its function name to this one.
const PROFILE_SIGNUP_TRIGGER =
  /create\s+trigger\s+\w+\s+after\s+insert\s+on\s+auth\.users\b[^;]*?execute\s+(?:function|procedure)\s+(?:public\.)?(\w+)/i;

// A function's declaration *including* its body. functionStatements() above
// deliberately drops the body, because it is reading attributes and a `;` inside
// a body would end the statement early. Here the body is the whole point: what
// makes the trigger the fix is the insert written inside it.
function functionSource(migrations: Migration[], name: string): string | null {
  const declaration = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\b`,
    'i',
  );

  for (const { sql } of migrations) {
    const match = declaration.exec(sql);
    if (match === null) continue;

    const rest = sql.slice(match.index);
    const open = /\$\w*\$/.exec(rest);
    if (open === null) return rest;

    const bodyStart = open.index + open[0].length;
    const close = rest.indexOf(open[0], bodyStart);
    return close === -1 ? rest : rest.slice(0, close);
  }

  return null;
}

// Every auth user must get a profiles row, and the migrations are the only place
// that can be true of *every* signup path.
//
// This is the second bug of the same family as the missing tables above: not SQL
// that fails to run, but SQL that runs and leaves the schema unable to support the
// app. public.profiles shipped with a select policy, an update policy and no
// insert policy, because its one writer was the beta signup route reaching past
// RLS with the service-role key. That held only while every rider arrived through
// an invite. A rider signing up any other way - the ordinary form once
// BETA_INVITE_ONLY is off, or an OAuth provider - never touches a route handler
// before the account exists, so no application code can be the choke point.
// Reading degrades correctly (resolveUserAccess(null) is the free tier). Paying
// does not: app/api/stripe/checkout/route.ts cannot attach a Stripe customer to a
// row that is not there, and returns "Unable to link your billing account" for as
// long as the account exists.
//
// WHAT THIS CATCHES: the trigger being dropped, renamed out from under its
// trigger, or replaced by one that runs on signup and does something other than
// create the row.
//
// WHAT IT DOES NOT CATCH: it reads SQL as text like everything else here, so it
// cannot see a trigger disabled on the hosted project, and it does not prove the
// insert succeeds - `security definer`, the owner's privileges and search_path all
// have to be right, and only signing up against a rebuilt database shows that.
// That walk is recorded in the migration's own comments.
function profileWriterViolations(migrations: Migration[]): string[] {
  for (const { file, sql } of migrations) {
    const trigger = PROFILE_SIGNUP_TRIGGER.exec(sql);
    if (trigger === null) continue;

    const name = trigger[1];
    const source = functionSource(migrations, name);
    if (source === null) {
      return [`${file}: trigger on auth.users calls public.${name}, which no migration defines`];
    }
    if (!/insert\s+into\s+public\.profiles\b/i.test(source)) {
      return [
        `${file}: public.${name} runs on every signup but never inserts into public.profiles`,
      ];
    }

    return [];
  }

  return ['no migration installs an after-insert trigger on auth.users'];
}

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

  it('gives profiles a writer that every signup path passes through', () => {
    expect(profileWriterViolations(migrations)).toEqual([]);
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

    // service_role is the trusted server identity, so it is the only role a
    // schema-wide grant may name. anon and authenticated are granted per table.
    expect(sql).toMatch(
      /grant\s+[^;]*\son\s+all\s+tables\s+in\s+schema\s+public\s+to\s+service_role\s*;/,
    );
    expect(sql).toMatch(
      /alter\s+default\s+privileges\s+in\s+schema\s+public\s+grant\s+[^;]*\son\s+tables\s+to\s+service_role\s*;/,
    );
    // The platform grants the Data API roles truncate, references and trigger on
    // its own, so these revokes are what actually removes them.
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+[^;]*\banon\b/,
    );
    expect(sql).toMatch(
      /alter\s+default\s+privileges\s+in\s+schema\s+public\s+revoke\s+all\s+on\s+tables\s+from\s+[^;]*\banon\b/,
    );
    expect(sql).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+[^;]*\banon\b/);
    // The app cannot read anything if authenticated never receives its tables.
    expect(sql).toMatch(/grant\s+[^;]*\son\s+public\.sessions\s+to\s+authenticated/);
  });

  // The regression test for the privilege escalation this schema shipped with.
  //
  // An ordinary authenticated user, holding only the public key and their own
  // session, could PATCH their own profiles row and set tier to pro,
  // beta_access_expires_at to a future date, and both Stripe identifiers. It was
  // reproduced twice against a rebuilt local database and returned HTTP 200 with
  // the elevated values. lib/access.ts grants Pro on either tier or beta access,
  // so that is paid entitlement for free, and rewriting stripe_customer_id points
  // a billing identifier wherever the caller likes.
  //
  // The cause is not the row policy, which is correct. Postgres RLS chooses which
  // ROW a policy admits and cannot restrict which COLUMN is written, so the only
  // thing standing between a user and their own tier column is whether
  // `authenticated` holds UPDATE on the table at all. Narrowing an earlier
  // `grant all` to CRUD did not help, because UPDATE is the privilege that
  // matters.
  //
  // WHAT THIS CATCHES: any migration granting anon or authenticated more than
  // SELECT on profiles, and any schema-wide or default-privilege table grant that
  // reaches those roles and would sweep profiles up with everything else.
  //
  // WHAT IT DOES NOT CATCH: it reads SQL as text. It cannot see a grant made by
  // hand in the dashboard, and it says nothing about the hosted project, whose
  // privileges are not described by these files. Proving the attack fails needs a
  // rebuilt database and a real Data API request, which is how this fix was
  // verified and is recorded in CLAUDE.md.
  it('never lets a user write their own entitlement or billing columns', () => {
    const violations: string[] = [];

    for (const { file, sql } of migrations) {
      for (const match of sql.matchAll(
        /grant\s+([^;]*?)\s+on\s+(?:table\s+)?public\.profiles\s+to\s+([^;]*)/gi,
      )) {
        const [, privileges, targets] = match;
        const exposed = ['anon', 'authenticated', 'public'].filter((role) =>
          new RegExp(`\\b${role}\\b`, 'i').test(targets),
        );
        const writes = ['insert', 'update', 'delete', 'all'].filter((privilege) =>
          new RegExp(`\\b${privilege}\\b`, 'i').test(privileges),
        );
        if (exposed.length > 0 && writes.length > 0) {
          violations.push(`${file}: grant ${writes.join(', ')} on profiles to ${exposed.join(', ')}`);
        }
      }

      // A schema-wide or default grant reaching these roles would carry profiles
      // with it, whatever the per-table statements say.
      for (const match of sql.matchAll(
        /(?:grant\s+[^;]*?\s+on\s+all\s+tables\s+in\s+schema\s+public|alter\s+default\s+privileges[^;]*?\bgrant\s+[^;]*?\s+on\s+tables)\s+to\s+([^;]*)/gi,
      )) {
        const exposed = ['anon', 'authenticated', 'public'].filter((role) =>
          new RegExp(`\\b${role}\\b`, 'i').test(match[1]),
        );
        if (exposed.length > 0) {
          violations.push(`${file}: schema-wide table grant reaches ${exposed.join(', ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('reads security definer off the two functions that declare it', () => {
    // Without this the check below could pass by seeing no functions at all. A
    // statement parser that stopped matching would take the execute invariant
    // with it silently, so the classification is asserted rather than assumed. A
    // new `security definer` function belongs in this list, and needs the revoke
    // that putting it here will start requiring.
    //
    // Deduplicated, because a later migration may `create or replace` one of
    // these to fix its body. That is a second declaration of the same function,
    // not a classification change, and this assertion is aimed at the second.
    const definers = new Set(
      migrations.flatMap(({ sql }) =>
        functionStatements(sql)
          .filter(({ statement }) => /security\s+definer/i.test(statement))
          .map(({ name }) => name),
      ),
    );

    expect([...definers].sort()).toEqual([
      'consume_beta_rate_limit',
      'create_beta_invite',
      'handle_new_auth_user',
    ]);
  });

  it('leaves execute on a function to the migration that creates it', () => {
    expect(executeViolations(migrations)).toEqual([]);
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

// The tests above pass against a repository that got it right, and would pass just
// as happily against a deleted check. These feed the same analysis SQL that got it
// wrong, so what the guard catches is observed rather than assumed.
describe('the profiles-writer check, against migrations written wrongly on purpose', () => {
  it('catches a schema whose profiles table nothing ever writes to', () => {
    // The repository as it stood before 20260816001200. Nothing about this SQL
    // fails to apply, which is why the gap survived until someone tried to pay.
    expect(profileWriterViolations(loadFixtures('profiles_without_signup_trigger.sql'))).toEqual([
      'no migration installs an after-insert trigger on auth.users',
    ]);
  });

  it('catches a signup trigger that does something other than create the row', () => {
    // Checking only that a trigger exists would pass this. Analytics, audit rows
    // and welcome emails all belong on auth.users insert and none of them is the
    // fix, so the guard reads the function body rather than the attachment.
    expect(
      profileWriterViolations(loadFixtures('signup_trigger_without_profile_insert.sql')),
    ).toEqual([
      'signup_trigger_without_profile_insert.sql: public.handle_new_auth_user runs on every signup but never inserts into public.profiles',
    ]);
  });
});

describe('the execute check, against migrations written wrongly on purpose', () => {
  it('catches a security definer function whose migration never mentions execute', () => {
    expect(executeViolations(loadFixtures('definer_without_revoke.sql'))).toEqual([
      'definer_without_revoke.sql: security definer function public.promote_rider never says whether public may execute it',
    ]);
  });

  it('catches a security definer function whose attributes follow its body', () => {
    // `as $$ ... $$ language plpgsql security definer;` is the same declaration
    // written the other way round, and the option list is order-independent, so
    // a reader that stopped at the opening `$` would call this an ordinary
    // function and say nothing about the missing revoke.
    expect(executeViolations(loadFixtures('definer_attributes_after_body.sql'))).toEqual([
      'definer_attributes_after_body.sql: security definer function public.promote_rider never says whether public may execute it',
    ]);
  });

  it('catches a security definer function created without its schema qualifier', () => {
    // search_path lands it in public regardless, so it is the same function and
    // the same hole.
    expect(executeViolations(loadFixtures('definer_unqualified_name.sql'))).toEqual([
      'definer_unqualified_name.sql: security definer function public.promote_rider never says whether public may execute it',
    ]);
  });

  it('accepts an unqualified function whose revoke is unqualified too', () => {
    // The other side of the widened match: reading the create without reading
    // the revoke the same way would fail an author who did write the decision.
    expect(executeViolations(loadFixtures('definer_unqualified_with_revoke.sql'))).toEqual([]);
  });

  it('catches a revoke that names anon and authenticated but not public', () => {
    // Both are members of public, so the statement reads like a lockdown and is not one.
    expect(executeViolations(loadFixtures('definer_revoked_from_anon_only.sql'))).toEqual([
      'definer_revoked_from_anon_only.sql: security definer function public.promote_rider never says whether public may execute it',
    ]);
  });

  it('accepts the revoke / grant execute pair the real migrations use', () => {
    expect(executeViolations(loadFixtures('definer_with_revoke.sql'))).toEqual([]);
  });

  it('accepts a security definer function granted to public on purpose', () => {
    // The escape hatch. The invariant is that the decision is written down, not
    // that every function is locked, so an author who means it says so and passes.
    expect(executeViolations(loadFixtures('definer_granted_to_public_on_purpose.sql'))).toEqual([]);
  });

  it('leaves security invoker functions alone', () => {
    // They run as their caller, so RLS still applies and execute is not the
    // access control. Two of the three in supabase/migrations/ have no revoke.
    expect(executeViolations(loadFixtures('invoker_without_revoke.sql'))).toEqual([]);
  });

  it('leaves a schema-wide grant of execute to service_role alone', () => {
    // service_role never leaves the server and already bypasses RLS, so it is not
    // the role the per-function revokes are defending against. Widening the
    // pattern to catch `public` must not have swept this up with it.
    const fixtures = loadFixtures(
      'definer_with_revoke.sql',
      'grant_all_routines_to_service_role.sql',
    );

    expect(executeViolations(fixtures)).toEqual([]);
  });

  for (const role of ['anon', 'authenticated', 'public']) {
    it(`catches a schema-wide grant of execute to ${role}`, () => {
      const fixtures = loadFixtures('definer_with_revoke.sql', `grant_all_routines_to_${role}.sql`);

      expect(executeViolations(fixtures)).toEqual([
        `grant_all_routines_to_${role}.sql: grant on all routines re-exposes promote_rider`,
      ]);
    });

    it(`catches a routines default privilege granting execute to ${role}`, () => {
      const fixtures = loadFixtures(`default_privileges_routines_to_${role}.sql`);

      expect(executeViolations(fixtures)).toEqual([
        `default_privileges_routines_to_${role}.sql: alter default privileges exposes every function added after it`,
      ]);
    });
  }
});
