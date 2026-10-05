import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  compareInventories,
  describeUnusableInventory,
  formatDriftReport,
  hasDrift,
  main,
  parseInventoryCsv,
} from '@/scripts/schema-drift.mjs';

// The hosted drift checker (`npm run db:drift`): the parse and comparison it
// does over two inventories, and the command's exit codes with the local stack's
// inventory handed in, so none of it needs a database.
// Running the inventory itself against a real one is tests/db/schema-inventory.spec.ts.

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

describe('platform-managed lines', () => {
  const STORAGE_TRIGGER =
    'TRIGGER storage.objects update_objects_updated_at enabled=O CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column()';
  const OWN_STORAGE_TRIGGER =
    'TRIGGER storage.objects stamp_photo enabled=O CREATE TRIGGER stamp_photo BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.stamp_photo()';
  const UNQUALIFIED_STORAGE_TRIGGER =
    'TRIGGER storage.objects stamp_photo enabled=O CREATE TRIGGER stamp_photo BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION stamp_photo()';
  const ALL_SCHEMAS_DEFACL = 'DEFACL schema=<all> owner=postgres objtype=f postgres=EXECUTE';
  const PLATFORM_DEFACL = 'DEFACL schema=public owner=supabase_admin objtype=f anon=EXECUTE, authenticated=EXECUTE';
  const OWN_DEFACL = 'DEFACL schema=public owner=postgres objtype=f postgres=EXECUTE';

  it('prints platform-owned differences apart and does not count them as drift', () => {
    const result = compareInventories(
      [PROFILES, 'EXTENSION pg_net version=0.20.3 schema=extensions', STORAGE_TRIGGER, PLATFORM_DEFACL],
      [PROFILES, 'EXTENSION pg_net version=0.14.0 schema=extensions', ALL_SCHEMAS_DEFACL],
    );

    expect(hasDrift(result)).toBe(false);
    expect(result.platform).toEqual({
      missingFromHosted: [PLATFORM_DEFACL, 'EXTENSION pg_net version=0.20.3 schema=extensions', STORAGE_TRIGGER].sort(),
      onlyOnHosted: [ALL_SCHEMAS_DEFACL, 'EXTENSION pg_net version=0.14.0 schema=extensions'].sort(),
    });

    const report = formatDriftReport(result);
    expect(report).toMatch(/^No drift/);
    expect(report).toContain('Platform-managed, informational');
    expect(report).toContain(`  - ${STORAGE_TRIGGER}`);
    expect(report).toContain(`  + ${ALL_SCHEMAS_DEFACL}`);
  });

  it('counts an extension missing from one side as drift', () => {
    const result = compareInventories([PROFILES, 'EXTENSION pg_cron version=1.6.4 schema=pg_catalog'], [PROFILES]);

    expect(result.missingFromHosted).toEqual(['EXTENSION pg_cron version=1.6.4 schema=pg_catalog']);
    expect(result.platform.missingFromHosted).toEqual([]);
  });

  it('counts a storage.objects trigger on a public function, and a migration-made default privilege, as drift', () => {
    const result = compareInventories([PROFILES, OWN_STORAGE_TRIGGER, OWN_DEFACL], [PROFILES, UNQUALIFIED_STORAGE_TRIGGER]);

    expect(result.missingFromHosted).toEqual([OWN_DEFACL, OWN_STORAGE_TRIGGER].sort());
    expect(result.onlyOnHosted).toEqual([UNQUALIFIED_STORAGE_TRIGGER]);
    expect(result.platform).toEqual({ missingFromHosted: [], onlyOnHosted: [] });
  });
});

describe('npm run db:drift', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'schema-drift-'));
  const write = (name: string, text: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    return file;
  };
  const run = (argv: string[], readReference: () => string[] = () => reference) => {
    const out: string[] = [];
    const err: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(line));
    const error = vi.spyOn(console, 'error').mockImplementation((line: string) => void err.push(line));
    try {
      const status = main(argv, readReference);
      return { status, stdout: out.join('\n'), stderr: err.join('\n') };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  };

  it('exits 1 and names the drift', () => {
    const result = run([write('hosted.csv', csv(hosted))]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`- ${OUTCOME_FN}`);
    expect(result.stdout).toContain(`+ ${LEGACY_FN}`);
  });

  it('exits 0 when the two agree', () => {
    const result = run([write('same.csv', csv(reference))]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^No drift/);
  });

  it('exits 0 when only platform-managed lines differ', () => {
    const result = run(
      [write('platform.csv', csv([...reference, 'EXTENSION pg_net version=0.14.0 schema=extensions']))],
      () => [...reference, 'EXTENSION pg_net version=0.20.3 schema=extensions'],
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('+ EXTENSION pg_net version=0.14.0 schema=extensions');
  });

  it('exits 2 rather than agreeing over two empty files', () => {
    const result = run([write('empty.csv', 'line\n')], () => []);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/empty/);
  });

  it('exits 2 with usage when no hosted file is given', () => {
    expect(run([]).status).toBe(2);
  });

  it('exits 2 when the reference cannot be read', () => {
    const result = run([write('no-stack.csv', csv(hosted))], () => {
      throw new Error('supabase db query failed (exit 1): no stack');
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('supabase db query failed (exit 1): no stack');
  });
});
