The call sites `tests/unit/rpc-call-sites.test.ts` must reject. Both leave
`/api/health` answering 200 while the feature behind the RPC is the one that is
broken:

- `unlisted-rpc-route.ts` - a deployment module calling an RPC that
  `REQUIRED_RPCS` does not list.
- `dynamic-rpc-name.ts` - an RPC named by a variable, which the sweep cannot
  read and so must report rather than count as covered.

It lives here rather than under `app/` or `lib/` so the collector does not find
it in the real sweep, exactly like `tests/fixtures/migration-guard/`.
