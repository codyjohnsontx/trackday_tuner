import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
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
 * The set of call sites is only discoverable by reading the sources a deployment
 * runs - there is no type or runtime seam that enumerates them - so the sweep is
 * the mechanism rather than a proxy for one, and it is proven against
 * `tests/fixtures/rpc-call-sites/` below rather than only against a repository
 * that already gets it right.
 *
 * IT READS CODE, NOT TEXT, and that is the whole difference. Matching over file
 * text cannot tell a call from prose or from a quote inside a regex literal, and
 * both mistakes were made here: `supabase.rpc()` in a doc comment was reported as
 * a call with an unreadable name, and hand-tracking quote state inverted its
 * parity on `lib/session-export.ts`'s `/[",\r\n]/` and read the rest of that file
 * as one long string. A guard that mis-parses is worse than a narrower one,
 * because it answers confidently - the same shape as an audit reporting
 * "seventeen of seventeen" while blind to an eighteenth. So the file is parsed
 * with the TypeScript compiler already in `devDependencies` and the call sites
 * are AST nodes: comments are not nodes, a regex literal is one token, and a
 * name that is not a literal is a property of the node rather than of a
 * character count.
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
 * by name rather than by pattern, so reading it tells you which file it is.
 */
const THE_MODULE_BEING_CHECKED = 'lib/monitoring/schema-contract.ts';

interface RpcCallSite {
  file: string;
  /** The name the call passes, or `null` when it is not a literal to read. */
  rpc: string | null;
}

/** Every `<something>.rpc(...)` call the given source actually makes. */
function rpcCallSitesIn(file: string, text: string): RpcCallSite[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: RpcCallSite[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'rpc'
    ) {
      const [name] = node.arguments;
      sites.push({ file, rpc: name && ts.isStringLiteralLike(name) ? name.text : null });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
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

function rpcCallSitesUnder(dirs: string[]): RpcCallSite[] {
  const sites: RpcCallSite[] = [];
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const relative = path.relative(ROOT, file);
      sites.push(...rpcCallSitesIn(relative, readFileSync(file, 'utf8')));
    }
  }
  return sites;
}

/**
 * A `.rpc()` whose name is not a literal cannot be read, and would leave the
 * sweep quietly reporting full coverage of a set it could not see.
 */
function unreadableCallSites(sites: RpcCallSite[]): string[] {
  return [
    ...new Set(
      sites
        .filter((site) => site.rpc === null && site.file !== THE_MODULE_BEING_CHECKED)
        .map((site) => site.file),
    ),
  ].sort();
}

const contracted = new Set(REQUIRED_RPCS.map((contract) => contract.name as string));
const FIXTURES = path.resolve(__dirname, '../fixtures/rpc-call-sites');

describe('supabase.rpc() call sites', () => {
  const allSites = rpcCallSitesUnder(DEPLOYMENT_TREES.map((dir) => path.join(ROOT, dir)));
  const named = allSites.filter((site): site is { file: string; rpc: string } => site.rpc !== null);

  // If this is empty the sweep broke rather than the coverage being perfect,
  // and every assertion below would pass over nothing.
  it('finds the RPC call sites to check', () => {
    expect(named.length).toBeGreaterThan(0);
    expect(new Set(named.map((site) => site.rpc)).size).toBeGreaterThan(1);
  });

  // A parser that lost a call would leave every assertion below passing over
  // less than it should. These three are the RPCs a deployment calls today.
  it('reads exactly the RPCs a deployment calls', () => {
    expect(new Set(named.map((site) => site.rpc))).toEqual(
      new Set(['save_session_outcome', 'replace_session_laps', 'consume_beta_rate_limit']),
    );
  });

  // THE REGRESSION. `lib/session-export.ts:217` is `/[",\r\n]/` - a regex
  // literal holding a double quote - which inverted a hand-written scanner's
  // quote parity and made it read the rest of the file as a string. The file
  // calls no RPC at all, and that is what the sweep has to say about it.
  it('reads a file whose regex literal contains a quote', () => {
    const file = 'lib/session-export.ts';

    expect(rpcCallSitesIn(file, readFileSync(path.join(ROOT, file), 'utf8'))).toEqual([]);
  });

  // Prose is not a call site. `lib/monitoring/schema-contract.ts` carries
  // `supabase.rpc()` in its doc comments, which is what this guard once
  // reported as a call with an unreadable name.
  it('does not read an RPC call written in a comment', () => {
    const sites = rpcCallSitesIn(
      'commented.ts',
      [
        "/** Calls supabase.rpc('ghost_rpc') on every save. */",
        "// and supabase.rpc('phantom_rpc') too",
        'export const unrelated = 1;',
      ].join('\n'),
    );

    expect(sites).toEqual([]);
  });

  // A quote inside a regex literal must not swallow the call that follows it.
  it('still reads a call that follows a quote-bearing regex literal', () => {
    const sites = rpcCallSitesIn(
      'quoted.ts',
      [
        'export function escape(raw: string) {',
        '  if (!/[",\\r\\n]/.test(raw)) return raw;',
        '  return `"${raw.replaceAll(\'"\', \'""\')}"`;',
        '}',
        "export const run = (db: { rpc: (n: string) => void }) => db.rpc('kept_rpc');",
      ].join('\n'),
    );

    expect(sites).toEqual([{ file: 'quoted.ts', rpc: 'kept_rpc' }]);
  });

  // THE COMPOSITE the hand-written scanner failed on: a quote-bearing regex
  // inverted its parity, so no comment after it was stripped, and prose further
  // down was counted as a call with an unreadable name. Both halves in one file.
  it('ignores prose that follows a quote-bearing regex literal', () => {
    const sites = rpcCallSitesIn(
      'composite.ts',
      [
        'export function escape(raw: string) {',
        '  if (!/[",\\r\\n]/.test(raw)) return raw;',
        '  return raw;',
        '}',
        "/** Later prose mentioning supabase.rpc('ghost_rpc'). */",
        'export const unrelated = 1;',
      ].join('\n'),
    );

    expect(sites).toEqual([]);
    expect(unreadableCallSites(sites)).toEqual([]);
  });

  it('reads every `.rpc()` in the deployment trees', () => {
    expect(
      unreadableCallSites(allSites),
      'an `.rpc()` here is called with a name this sweep cannot read, so it cannot be covered',
    ).toEqual([]);
  });

  // The exclusion is only sound while a dispatch really is the only unreadable
  // call in that file, so the sweep is watched reporting one.
  it('reports a call site whose RPC name it cannot read', () => {
    expect(unreadableCallSites(rpcCallSitesUnder([FIXTURES]))).toEqual([
      path.relative(ROOT, path.join(FIXTURES, 'dynamic-rpc-name.ts')),
    ]);
  });

  it('has every RPC a deployment calls on the schema_contract list', () => {
    const uncovered = named
      .filter((site) => !contracted.has(site.rpc) && !OPERATOR_ONLY_RPCS.has(site.rpc))
      .map((site) => `${site.rpc} (${site.file})`)
      .sort();

    expect(uncovered, 'add these to REQUIRED_RPCS in lib/monitoring/schema-contract.ts').toEqual([]);
  });

  // Proven against the fault rather than only against a repository that is
  // already right: an unlisted RPC in a deployment tree has to be named.
  it('names an RPC that is missing from the list', () => {
    const uncovered = rpcCallSitesUnder([FIXTURES]).filter(
      (site) => site.rpc !== null && !contracted.has(site.rpc) && !OPERATOR_ONLY_RPCS.has(site.rpc),
    );

    expect(uncovered).toEqual([
      { file: 'tests/fixtures/rpc-call-sites/unlisted-rpc-route.ts', rpc: 'archive_rider_history' },
    ]);
  });

  // The exclusion is only safe while it stays true, so it is checked rather
  // than asserted in a comment.
  it('keeps create_beta_invite off the list because no deployment code calls it', () => {
    expect(named.map((site) => site.rpc)).not.toContain('create_beta_invite');
    expect(contracted.has('create_beta_invite')).toBe(false);
  });
});
