## What changed

<!-- One paragraph. What does this do, and why now? -->

## Test plan

<!-- What you ran, and what you watched fail before it passed. -->

## RAG evaluation

<!--
REQUIRED for any change touching lib/rag/, docs/knowledge-base/, data/rag-index.json
or the golden set. Delete this section otherwise.

Run `npm run rag:eval` and paste the "Against baseline" block below. That block
is the evidence that a prompt or retrieval change was compared before shipping
rather than after.

If the run reports missing recordings, the change moved the prompt - that is the
harness working. Re-record with `OPENAI_API_KEY=... npm run rag:eval -- --live`,
commit tests/fixtures/rag-eval/recordings/, and paste the diff.

Re-baseline only deliberately, with `npm run rag:eval -- --update-baseline`, and
say here why the new numbers are the ones to keep.
-->

```
Against baseline
  rubric pass rate     ...
  recall@4             ...
  MRR                  ...
```
