import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INVENTORY_SQL_PATH,
  compareInventories,
  describeUnusableInventory,
  formatDriftReport,
  hasDrift,
  parseInventoryCsv,
} from '@/scripts/schema-drift.mjs';

// The hosted drift checker (`npm run db:drift`): the parse and comparison it
// does over two inventories, and the CLI's exit codes, without a database.
// Running the inventory itself against a real one is tests/db/schema-inventory.spec.ts.

const SCRIPT = path.resolve(path.dirname(INVENTORY_SQL_PATH), '../schema-drift.mjs');

// Lines in the shape the inventory prints, from the drift the report on the
// hosted project found: save_session_outcome missing there, a hand-made
// handle_new_user present there, and the CLI history table only on one side.
const OUTCOME_FN =
  'FUNCTION public.save_session_outcome(p_user_id uuid) returns=jsonb lang=plpgsql security=INVOKER volatile=v searchpath=- bodymd5=aaa owner=postgres';
const OUTCOME_GRANT = 'FUNCGRANT public.save_session_outcome(p_user_id uuid) authenticated=EXECUTE, postgres=EXECUTE';
const LEGACY_FN =
  'FUNCTION public.handle_new_user() returns=trigger lang=plpgsql security=DEFINER volatile=v searchpath=- bodymd5=bbb owner=postgres';
const PROFILES = 'TABLE public.profiles kind=table owner=postgres options=-';
const TRIGGER_REF =
  'TRIGGER auth.users on_auth_user_created enabled=O CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user()';
const TRIGGER_HOSTED =
  'TRIGGER auth.users on_auth_user_created enabled=O CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()';

const reference = [PROFILES, OUTCOME_FN, OUTCOME_GRANT, TRIGGER_REF, 'MIGRATIONS table_exists=true'];
const hosted = [PROFILES, LEGACY_FN, TRIGGER_HOSTED, 'MIGRATIONS table_exists=false'];

function csv(lines: string[]): string {
  const quote = (line: string) => (/[",]/.test(line) ? `"${line.replace(/"/g, '""')}"` : line);
  return ['line', ...lines.map(quote)].join('\n') + '\n';
}

describe('parseInventoryCsv', () => {
  it('reads the SQL editor download back to the lines the inventory printed', () => {
    const lines = [PROFILES, OUTCOME_GRANT, 'FUNCTION public.f() searchpath=search_path="" bodymd5=c'];
    expect(parseInventoryCsv(`﻿${csv(lines).replace(/\n/g, '\r\n')}`)).toEqual(lines);
  });

  it('reads a file with no header row', () => {
    expect(parseInventoryCsv(`${PROFILES}\n`)).toEqual([PROFILES]);
  });

  it('refuses a quoted field that never closes', () => {
    expect(() => parseInventoryCsv('line\n"FUNCGRANT public.f() a=EXECUTE, b=EXECUTE\n')).toThrow(
      /Unterminated/,
    );
  });
});

describe('compareInventories', () => {
  it('names what hosted is missing, what only hosted has, and what changed', () => {
    const result = compareInventories(reference, hosted);

    expect(result.missingFromHosted).toEqual([OUTCOME_FN, OUTCOME_GRANT, TRIGGER_REF].sort());
    expect(result.onlyOnHosted).toEqual([LEGACY_FN, TRIGGER_HOSTED].sort());
    expect(hasDrift(result)).toBe(true);
  });

  it('does not count the CLI history table as drift', () => {
    const result = compareInventories(
      [PROFILES, 'MIGRATIONS table_exists=true'],
      [PROFILES, 'MIGRATIONS table_exists=false'],
    );

    expect(hasDrift(result)).toBe(false);
    expect(result.notes).toEqual(['MIGRATIONS table_exists=false', 'MIGRATIONS table_exists=true']);
  });

  it('reports no drift between identical inventories', () => {
    const result = compareInventories(reference, [...reference].reverse());
    expect(hasDrift(result)).toBe(false);
    expect(formatDriftReport(result)).toMatch(/^No drift/);
  });

  it('prints each side under its own heading', () => {
    const report = formatDriftReport(compareInventories(reference, hosted));
    expect(report).toContain(`  - ${OUTCOME_FN}`);
    expect(report).toContain(`  + ${LEGACY_FN}`);
    expect(report).toMatch(/^Drift: 3 line\(s\) .* 2 line\(s\)/);
  });
});

describe('describeUnusableInventory', () => {
  it('refuses an empty inventory', () => {
    expect(describeUnusableInventory('hosted', [])).toMatch(/empty/);
  });

  it('refuses a file that is not an inventory', () => {
    expect(describeUnusableInventory('hosted', ['ordinality,migration,status'])).toMatch(/no TABLE lines/);
  });

  it('accepts an inventory', () => {
    expect(describeUnusableInventory('hosted', reference)).toBeNull();
  });
});

describe('npm run db:drift', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'schema-drift-'));
  const write = (name: string, text: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    return file;
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('exits 1 and names the drift', () => {
    const result = run(write('hosted.csv', csv(hosted)), '--reference', write('ref.csv', csv(reference)));

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`- ${OUTCOME_FN}`);
    expect(result.stdout).toContain(`+ ${LEGACY_FN}`);
  });

  it('exits 0 when the two agree', () => {
    const file = write('same.csv', csv(reference));
    const result = run(file, '--reference', file);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^No drift/);
  });

  it('exits 2 rather than agreeing over two empty files', () => {
    const empty = write('empty.csv', 'line\n');
    const result = run(empty, '--reference', empty);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/empty/);
  });

  it('exits 2 with usage when no hosted file is given', () => {
    expect(run().status).toBe(2);
  });
});

describe('scripts/sql/schema-inventory.sql', () => {
  // The owner pastes this into the hosted SQL editor, which runs as postgres, so
  // the promise that it changes nothing and reads no rider row has to be true of
  // the text. That it runs, and runs the same twice, is the real-database spec.
  const sql = readFileSync(INVENTORY_SQL_PATH, 'utf8')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");

  it('is one statement', () => {
    expect(sql.trim().replace(/;\s*$/, '')).not.toContain(';');
  });

  it('writes nothing and changes no role or setting', () => {
    expect(sql).not.toMatch(
      /\b(?:insert|update|delete|truncate|create|alter|drop|grant|revoke|copy|set|reset|notify|call|do|lock|vacuum|analyze)\b/i,
    );
  });

  it('reads catalogues and bucket configuration, never an application table', () => {
    const sources = Array.from(sql.matchAll(/\b(?:from|join)\s+(?:lateral\s+)?([\w.]+)/gi), (match) => match[1].toLowerCase());
    const allowed = /^(?:pg_\w+|storage\.buckets|scoped_ns|scoped_rel|lines|aclexplode|unnest)$/;

    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((source) => !allowed.test(source))).toEqual([]);
  });
});
