#!/usr/bin/env node
/**
 * `npm run rag:eval` - the RAG evaluation harness.
 *
 *   npm run rag:eval                          replay committed recordings (default, no key)
 *   npm run rag:eval -- --live                call the real API and re-record
 *   npm run rag:eval -- --update-baseline     write the run's scores to eval-baseline.json
 *
 * This entry point exists to register the TypeScript resolve hook before
 * anything imports `lib/rag/`. A module hook has to be installed before the
 * graph it affects is loaded, so the work lives in `scripts/eval/run.mjs` behind
 * a dynamic import rather than a static one here.
 *
 * Node >= 22.18 strips types from `.ts` without a flag, which is why nothing is
 * transpiled and no build step or dependency was added. CI pins Node 24.
 */
import { register } from 'node:module';

register('./eval/ts-loader.mjs', import.meta.url);

const { main } = await import('./eval/run.mjs');

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  console.error('[rag:eval]', err);
  process.exitCode = 1;
}
