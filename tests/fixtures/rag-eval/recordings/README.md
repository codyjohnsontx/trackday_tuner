# RAG eval recordings

`npm run rag:eval` replays the request/response pairs in this directory so the
whole pipeline - embed, retrieve, prompt, model, policy - runs in CI with no
OpenAI key and no network. `embeddings.json` and `completions.json` are written
by `npm run rag:eval -- --live` and are meant to be committed.

Each entry is keyed by the first 32 hexadecimal characters - 128 bits - of a
SHA-256 over the request itself: method, path, and the canonicalized JSON body.
**The request is therefore the key**, and the prompt is the part of it that
usually moves. Change
`SYSTEM_PROMPT`, the component vocabulary, the knowledge index or a golden case
and the affected keys move, offline mode reports a miss by name, and CI goes red
until the recordings are refreshed alongside the change. That is the point: the
harness this replaced could not detect a prompt change at all, and the largest
prompt change in the project's history shipped without it noticing.

Embeddings are stored exactly as the API returns them, which is base64-encoded
float32 - the OpenAI SDK sends `encoding_format: 'base64'` by default and decodes
client-side. Do not "helpfully" expand them to float arrays: the SDK would then
try to base64-decode a JSON array and every retrieval would come back empty.

To refresh:

```bash
OPENAI_API_KEY=... npm run rag:eval -- --live      # re-record and re-score
npm run rag:eval                                   # confirm the replay matches
npm run rag:eval -- --update-baseline              # only when the new scores are the ones to keep
```
