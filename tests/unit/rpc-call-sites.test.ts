import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_RPCS } from '@/lib/monitoring/schema-contract';

/**
 * `/api/health`'s `schema_contract` check can only report on the RPCs
 * `REQUIRED_RPCS` lists. A new `supabase.rpc()` call site that is not on that
 * list gets the Save Outcome outage back in full: its migration is unapplied in
 * production, the feature fails for riders, and the check that exists to say so
 * keeps answering 200 with `detail: "3 rpcs"` - green because it was never
 * asked.
 *
 * That rule lived only as prose in CLAUDE.md, and this repository already
 * decided prose is not enough for the neighbouring invariant: `next.config.ts`'s
 * `outputFileTracingIncludes` is the same shape and
 * `tests/unit/rag-index-bundling.test.ts` walks the import graph to hold it.
 * This is that precedent applied to the RPC list.
 *
 * The set of call sites is only discoverable by sweeping the sources a
 * deployment runs - there is no type or runtime seam that enumerates them - so
 * the sweep is the mechanism rather than a proxy for one, and it is proven
 * against `tests/fixtures/rpc-call-sites/` below rather than only against a
 * repository that already gets it right.
 *
 * IT HAS TO BE ABLE TO SEE ITSELF. A raw match over the file text cannot tell
 * code from prose, and this guard first failed on the very module it checks:
 * `supabase.rpc()` written in a doc comment read as a call site with an
 * unreadable name, so it reported a wrong reason confidently - the same shape as
 * an audit answering "seventeen of seventeen" while blind to an eighteenth. So
 * comments are removed before anything is matched, and quotes are tracked while
 * removing them so a `//` inside a string cannot swallow a real call.
 */

const ROOT = path.resolve(__dirname, '../..');

/** The directories a DEPLOYMENT runs. `scripts/` is a laptop, not a server. */
const DEPLOYMENT_TREES = ['app', 'lib'];

/**
 * Reached only from `scripts/beta-invites.mjs`, which an operator runs by hand.
 * It is on no rider path, so a deployment whose database lacks it breaks no
 * request and failing `/api/health` over it would be a false alarm. Named here
 * rather than omitted so dropping the exclusion is a deliberate edit.
 */
const OPERATOR_ONLY_RPCS = new Set(['create_beta_invite']);

/**
 * The contract module is the thing being CHECKED, not a caller: its one
 * `.rpc()` is the probe loop dispatching over `REQUIRED_RPCS` itself, so its
 * name is the list by construction and there is nothing here to cover. Excluded
 * by name rather than by pattern, so the exclusion covers this file and reading
 * it tells you which file it is.
 */
const THE_MODULE_BEING_CHECKED = 'lib/monitoring/schema-contract.ts';

const RPC_CALL = /\.rpc\(\s*(['"`])([A-Za-z0-9_]+)\1/g;
const RPC_ANY = /\.rpc\(/g;

/**
 * `source` with comments removed and string and template literals left intact.
 *
 * Quote state is tracked rather than assumed, because stripping from a bare
 * `//` would truncate any line holding one inside a string and could hide a real
 * call site - a sweep failing OPEN is worse than one failing loud.
 */
function withoutComments(source: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === '\\') {
        out += char + (next ?? '');
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

interface CallSite {
  file: string;
  rpc: string;
}

function collectRpcCallSites(dirs: string[]): CallSite[] {
  const sites: CallSite[] = [];
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(RPC_CALL)) {
        sites.push({ file: path.relative(ROOT, file), rpc: match[2] });
      }
    }
  }
  return sites;
}

/**
 * A `.rpc()` whose name is not a literal cannot be swept, and would leave the
 * sweep quietly reporting full coverage of a set it could not see.
 */
function unreadableCallSites(dirs: string[]): string[] {
  const unreadable: string[] = [];
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const relative = path.relative(ROOT, file);
      if (relative === THE_MODULE_BEING_CHECKED) continue;
      const source = withoutComments(readFileSync(file, 'utf8'));
      const total = [...source.matchAll(RPC_ANY)].length;
      const named = [...source.matchAll(RPC_CALL)].length;
      if (total > named) unreadable.push(relative);
    }
  }
  return unreadable;
}

const contracted = new Set(REQUIRED_RPCS.map((contract) => contract.name as string));

describe('supabase.rpc() call sites', () => {
  const callSites = collectRpcCallSites(DEPLOYMENT_TREES.map((dir) => path.join(ROOT, dir)));

  // If this is empty the sweep broke rather than the coverage being perfect,
  // and every assertion below would pass over nothing.
  it('finds the RPC call sites to check', () => {
    expect(callSites.length).toBeGreaterThan(0);
    expect(new Set(callSites.map((site) => site.rpc)).size).toBeGreaterThan(1);
  });

  // Comment stripping is what makes the sweep readable, and a stripper that ate
  // a string could quietly drop a real call and leave every assertion below
  // passing over less than it should. These three are the RPCs a deployment
  // calls today, so losing one has to be visible here.
  it('still sees the call sites that comment stripping runs over', () => {
    expect(new Set(callSites.map((site) => site.rpc))).toEqual(
      new Set(['save_session_outcome', 'replace_session_laps', 'consume_beta_rate_limit']),
    );
  });

  // Prose is not a call site. `lib/monitoring/schema-contract.ts` carries
  // `supabase.rpc()` in its doc comments, which is what this guard used to
  // report as an unreadable name.
  it('does not read an RPC call written in a comment', () => {
    const commented = withoutComments(
      ["/** calls supabase.rpc('ghost_rpc') in prose */", "// also supabase.rpc('phantom_rpc')", 'export const x = 1;'].join('\n'),
    );

    expect([...commented.matchAll(RPC_CALL)]).toEqual([]);
    expect([...commented.matchAll(RPC_ANY)]).toEqual([]);
  });

  it('does not mistake a comment marker inside a string for a comment', () => {
    const kept = withoutComments(`const url = 'http://x/y'; await supabase.rpc('kept_rpc', {});`);

    expect([...kept.matchAll(RPC_CALL)].map((match) => match[2])).toEqual(['kept_rpc']);
  });

  it('reads every `.rpc()` in the deployment trees', () => {
    expect(
      unreadableCallSites(DEPLOYMENT_TREES.map((dir) => path.join(ROOT, dir))),
      'an `.rpc()` here is called with a name this sweep cannot read, so it cannot be covered',
    ).toEqual([]);
  });

  // The exclusion is only sound while a dispatch really is the only thing in
  // that file, so the sweep is watched failing on a dynamic call site.
  it('reports a call site whose RPC name it cannot read', () => {
    expect(unreadableCallSites([path.resolve(__dirname, '../fixtures/rpc-call-sites')])).toEqual([
      'tests/fixtures/rpc-call-sites/dynamic-rpc-name.ts',
    ]);
  });

  it('has every RPC a deployment calls on the schema_contract list', () => {
    const uncovered = callSites
      .filter((site) => !contracted.has(site.rpc) && !OPERATOR_ONLY_RPCS.has(site.rpc))
      .map((site) => `${site.rpc} (${site.file})`)
      .sort();

    expect(uncovered, 'add these to REQUIRED_RPCS in lib/monitoring/schema-contract.ts').toEqual([]);
  });

  // Proven against the fault rather than only against a repository that is
  // already right: an unlisted RPC in a deployment tree has to be named.
  it('names an RPC that is missing from the list', () => {
    const fixture = collectRpcCallSites([path.resolve(__dirname, '../fixtures/rpc-call-sites')]);
    const uncovered = fixture.filter(
      (site) => !contracted.has(site.rpc) && !OPERATOR_ONLY_RPCS.has(site.rpc),
    );

    expect(uncovered).toEqual([
      { file: 'tests/fixtures/rpc-call-sites/unlisted-rpc-route.ts', rpc: 'archive_rider_history' },
    ]);
  });

  // The exclusion is only safe while it stays true, so it is checked rather
  // than asserted in a comment.
  it('keeps create_beta_invite off the list because no deployment code calls it', () => {
    expect(callSites.map((site) => site.rpc)).not.toContain('create_beta_invite');
    expect(contracted.has('create_beta_invite')).toBe(false);
  });
});
