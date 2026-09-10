import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  REQUIRED_RPCS,
  UNCOERCIBLE_PROBE_VALUE,
  findUnresolvableRpcs,
  type RpcContract,
} from '@/lib/monitoring/schema-contract';

const migrationsDir = path.resolve(__dirname, '../../supabase/migrations');

/**
 * The exact body PostgREST returned for a missing `save_session_outcome`,
 * recorded off a real stack rather than written from memory. The whole point of
 * this check is to react to this payload, so a paraphrase of it would be testing
 * the paraphrase.
 *
 * A function that is present but whose schema cache is stale returns this same
 * body byte for byte, which is why the check cannot read `pg_proc` instead - see
 * the module doc comment.
 */
const PGRST202_BODY = {
  code: 'PGRST202',
  details:
    'Searched for the function public.save_session_outcome with parameters p_notes, p_outcome, p_recommendation_helpfulness, p_recommendation_id, p_reference_session_id, p_rider_confidence, p_session_id, p_symptoms, p_user_id or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
  hint: null,
  message:
    'Could not find the function public.save_session_outcome(p_notes, p_outcome, p_recommendation_helpfulness, p_recommendation_id, p_reference_session_id, p_rider_confidence, p_session_id, p_symptoms, p_user_id) in the schema cache',
};

/** `permission denied for function` - the function IS resolvable. Recorded too. */
const PERMISSION_DENIED_BODY = {
  code: '42501',
  details: null,
  hint: null,
  message: 'permission denied for function save_session_outcome',
};

/** What the uncoercible probe value actually earns: rejected before the body runs. */
const UNCOERCIBLE_BODY = {
  code: '22P02',
  details: null,
  hint: null,
  message: `invalid input syntax for type uuid: "${UNCOERCIBLE_PROBE_VALUE}"`,
};

/** A supabase-js client whose PostgREST answers `perRpc[name]` for each RPC. */
function stubClient(perRpc: Record<string, { status: number; body: unknown }>) {
  const seen: { name: string; body: Record<string, unknown> }[] = [];
  const fetchStub = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const name = url.split('/rpc/')[1] ?? '';
    seen.push({ name, body: JSON.parse(String(init?.body ?? '{}')) });
    const answer = perRpc[name] ?? { status: 200, body: null };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }) as unknown as typeof fetch;
  const client = createClient('http://postgrest.stub', 'service-role-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub },
  });
  return { client, seen };
}

function allResolvable(): Record<string, { status: number; body: unknown }> {
  return Object.fromEntries(
    REQUIRED_RPCS.map((c) => [c.name, { status: 400, body: UNCOERCIBLE_BODY }]),
  );
}

describe('findUnresolvableRpcs', () => {
  it('reports nothing when the Data API resolves every RPC', async () => {
    const { client } = stubClient(allResolvable());
    await expect(findUnresolvableRpcs(client)).resolves.toEqual([]);
  });

  // THE REGRESSION. This is the outage: `20260716000800` is not applied (or
  // PostgREST has not reloaded), the rider's save is refused, and their notes
  // are lost. If this check passed on this payload it would be a decoration.
  it('names save_session_outcome when PostgREST cannot find it in the schema cache', async () => {
    const { client } = stubClient({
      ...allResolvable(),
      save_session_outcome: { status: 404, body: PGRST202_BODY },
    });

    await expect(findUnresolvableRpcs(client)).resolves.toEqual(['save_session_outcome']);
  });

  it('reports every RPC the Data API cannot resolve, not just the first', async () => {
    const { client } = stubClient(
      Object.fromEntries(
        REQUIRED_RPCS.map((c) => [c.name, { status: 404, body: { ...PGRST202_BODY } }]),
      ),
    );

    await expect(findUnresolvableRpcs(client)).resolves.toEqual(
      REQUIRED_RPCS.map((c) => c.name),
    );
  });

  // A missing EXECUTE grant is a different fault with a different fix, and it is
  // NOT what this check exists to catch: PostgREST resolved the function, so the
  // schema is in step. Measured on a real stack - a revoked grant answers 403
  // `42501`, never `PGRST202`.
  it('treats permission denied as resolvable, because the schema is not what drifted', async () => {
    const { client } = stubClient({
      ...allResolvable(),
      save_session_outcome: { status: 403, body: PERMISSION_DENIED_BODY },
    });

    await expect(findUnresolvableRpcs(client)).resolves.toEqual([]);
  });

  it('sends each contract probe verbatim, so PostgREST matches on the real parameter names', async () => {
    const { client, seen } = stubClient(allResolvable());

    await findUnresolvableRpcs(client);

    for (const contract of REQUIRED_RPCS) {
      const call = seen.find((entry) => entry.name === contract.name);
      expect(call, `no probe sent for ${contract.name}`).toBeDefined();
      expect(Object.keys(call!.body).sort()).toEqual(Object.keys(contract.probe).sort());
    }
  });
});

// ---------------------------------------------------------------------------
// The contract has to describe the migrations, or the check passes while the
// deployment is broken in exactly the way it was written to catch.
// ---------------------------------------------------------------------------

/** Parameter name -> declared SQL type, from the LAST migration defining `name`. */
function declaredParameters(name: string): Map<string, string> {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let found: Map<string, string> | null = null;
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const start = sql.indexOf(`create or replace function public.${name}(`);
    if (start === -1) continue;
    const open = sql.indexOf('(', start);
    let depth = 0;
    let end = open;
    for (let i = open; i < sql.length; i += 1) {
      if (sql[i] === '(') depth += 1;
      else if (sql[i] === ')') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    const params = new Map<string, string>();
    for (const raw of sql.slice(open + 1, end).split(',')) {
      const trimmed = raw.replace(/--[^\n]*/g, ' ').trim();
      if (!trimmed) continue;
      const [pname, ...rest] = trimmed.split(/\s+/);
      params.set(pname, rest.join(' ').toLowerCase());
    }
    found = params;
  }
  if (!found) throw new Error(`no migration defines public.${name}`);
  return found;
}

/** Types the uncoercible sentinel cannot be parsed as, so the body never runs. */
const UNPARSEABLE_TYPES = ['uuid', 'integer', 'smallint', 'bigint', 'numeric'];

describe.each(REQUIRED_RPCS as RpcContract[])('$name contract', (contract) => {
  it('sends exactly the parameters its migration declares', () => {
    const declared = declaredParameters(contract.name);

    expect(Object.keys(contract.probe).sort()).toEqual([...declared.keys()].sort());
  });

  // Without this the probe would EXECUTE what it probes. `service_role` holds
  // execute on `consume_beta_rate_limit`, so a well-formed payload would spend a
  // real rate-limit slot every fifteen minutes.
  it('puts the uncoercible value in a parameter no value of that type can parse', () => {
    const declared = declaredParameters(contract.name);
    const poisoned = Object.entries(contract.probe)
      .filter(([, value]) => value === UNCOERCIBLE_PROBE_VALUE)
      .map(([key]) => declared.get(key) ?? '');

    expect(
      poisoned.some((type) => UNPARSEABLE_TYPES.includes(type)),
      `${contract.name} probe must poison a ${UNPARSEABLE_TYPES.join('/')} parameter`,
    ).toBe(true);
  });
});

describe('the code that actually calls these RPCs', () => {
  // The neighbouring failure: the route and the migration disagreeing by one
  // parameter produces the SAME PGRST202 message, with a `hint` naming the
  // signature it did find. Ruled out for this outage by reading both; locked
  // here so the next one is caught in CI instead of by a rider.
  it('sends the parameter names its migration declares', () => {
    const callSites: { rpc: string; file: string }[] = [
      { rpc: 'save_session_outcome', file: 'app/api/sessions/[id]/outcome/route.ts' },
      { rpc: 'replace_session_laps', file: 'lib/actions/sessions.ts' },
      { rpc: 'consume_beta_rate_limit', file: 'app/api/beta/waitlist/route.ts' },
    ];

    for (const { rpc, file } of callSites) {
      const source = readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
      const start = source.indexOf(`.rpc('${rpc}'`);
      expect(start, `${file} no longer calls ${rpc}`).toBeGreaterThan(-1);
      const open = source.indexOf('{', start);
      const close = source.indexOf('});', open);
      const sent = [...source.slice(open, close).matchAll(/^\s*(p_[a-z_]+):/gm)].map((m) => m[1]);

      expect(sent.sort(), `${file} drifted from the ${rpc} migration`).toEqual(
        [...declaredParameters(rpc).keys()].sort(),
      );
    }
  });
});
