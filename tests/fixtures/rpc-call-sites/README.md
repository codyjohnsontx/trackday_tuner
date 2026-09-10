The call site `tests/unit/rpc-call-sites.test.ts` must reject: a deployment
module calling an RPC that `REQUIRED_RPCS` does not list, so `/api/health`
would answer 200 while that feature is the one that is broken.

It lives here rather than under `app/` or `lib/` so the collector does not find
it in the real sweep, exactly like `tests/fixtures/migration-guard/`.
