/**
 * Record/replay for the two OpenAI endpoints this pipeline touches.
 *
 * THE INTERCEPT IS `globalThis.fetch`, NOT A MOCK OF `lib/rag/advice.ts`. That
 * is the whole point: `generateTuningAdvice` builds its own `OpenAI` client
 * internally and there is no injection seam, so stubbing at any higher level
 * would mean the harness scored a response the production code never parsed.
 * Intercepting the transport leaves the SDK, `parseAdviceResponse`,
 * `filterCitationsToRetrievedSources` and `ensureSafetyNotes` all real - a tape
 * replay exercises every line of the request path except the network.
 *
 * A tape entry is keyed by the SHA-256 of the request itself (method, url and
 * canonicalized body), so THE PROMPT IS THE KEY. Change `SYSTEM_PROMPT`, the
 * component vocabulary, a retrieved chunk or a golden case's session data, and
 * every affected key moves and offline mode reports a miss by name. That is the
 * mechanism the resume claim rests on: the harness cannot silently keep passing
 * across a prompt change the way the old one did.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const EMBEDDINGS_URL_FRAGMENT = '/embeddings';
const COMPLETIONS_URL_FRAGMENT = '/chat/completions';

/** Stable stringify: object key order must not change a request's identity. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function requestKey({ method, url, body }) {
  let canonicalBody = body;
  try {
    canonicalBody = JSON.stringify(canonicalize(JSON.parse(body)));
  } catch {
    // Non-JSON bodies hash as-is; nothing on this path sends one today.
  }
  return createHash('sha256')
    .update(`${method}\n${new URL(url).pathname}\n${canonicalBody}`)
    .digest('hex')
    .slice(0, 32);
}

function tapeKind(url) {
  if (url.includes(EMBEDDINGS_URL_FRAGMENT)) return 'embeddings';
  if (url.includes(COMPLETIONS_URL_FRAGMENT)) return 'completions';
  return null;
}

/**
 * An absent tape reads as an empty one, and that empty collection cannot yield
 * a pass: with no entries every request misses, `stats.misses` fills, and the
 * run exits 1 naming each key. So the degenerate case fails by construction
 * here rather than by a guard - which is why there is none.
 */
async function readTape(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return { version: 1, entries: {} };
    throw err;
  }
}

export class OpenAiTape {
  /**
   * @param {{ dir: string, mode: 'offline' | 'live' }} options
   */
  constructor({ dir, mode }) {
    this.dir = dir;
    this.mode = mode;
    this.tapes = { embeddings: null, completions: null };
    this.stats = { hits: 0, recorded: 0, misses: [] };
    // The keys this run actually replayed or recorded. `save({ prune: true })`
    // keeps only these, so it is correct ONLY after a run that reached every
    // case - see the soundness gate at its call site.
    this.used = { embeddings: new Set(), completions: new Set() };
    this.realFetch = null;
  }

  filePathFor(kind) {
    return path.join(this.dir, `${kind}.json`);
  }

  async load() {
    for (const kind of ['embeddings', 'completions']) {
      this.tapes[kind] = await readTape(this.filePathFor(kind));
    }
  }

  /**
   * @param {{ prune?: boolean }} [options] `prune` DELETES every committed entry
   *   this run did not replay or record. A partial run has not touched the keys
   *   it never got to, so this is safe ONLY when the run reached every case, and
   *   `describeUnsoundRun` (`scripts/eval/run.mjs`) is the single definition of
   *   when that holds - it requires `scored + errored` to equal the size of the
   *   golden set, alongside a self-check that had fixtures and passed them, no
   *   tape miss and no case that threw. That is the same soundness the baseline
   *   write requires, and the caller checks it; the flag alone promises nothing.
   *
   *   The conditions are named above rather than enumerated, because this
   *   comment used to carry its own copy of the list and it went stale on the
   *   clause that mattered: it promised "at least one case scored", which is
   *   exactly what a partial run satisfies while this deletes the recordings it
   *   never replayed. Read the function, not a second copy of it.
   *
   *   Without it the tape grows without bound: correcting a prompt moves the
   *   keys, and the old ones stay forever, so a committed fixture ends up
   *   holding entries no run will ever request and a reader cannot tell live
   *   from dead. That is the same "cannot tell whether it is checking anything"
   *   defect as the gates above, wearing a fixture.
   */
  async save({ prune = false } = {}) {
    await fs.mkdir(this.dir, { recursive: true });
    for (const kind of ['embeddings', 'completions']) {
      const tape = this.tapes[kind];
      // Sort by key so a re-record produces a reviewable diff rather than a
      // wholesale reordering of the file.
      const entries = Object.fromEntries(
        Object.keys(tape.entries)
          .filter((key) => !prune || this.used[kind].has(key))
          .sort()
          .map((key) => [key, tape.entries[key]]),
      );
      await fs.writeFile(
        this.filePathFor(kind),
        `${JSON.stringify({ ...tape, entries }, null, 2)}\n`,
        'utf8',
      );
    }
  }

  /** Replace `globalThis.fetch`. Returns a function that restores it. */
  install() {
    this.realFetch = globalThis.fetch;
    // An arrow keeps `this` without aliasing it, which matters here because the
    // SDK calls its fetch with `undefined` as the receiver.
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input?.url ?? String(input));
      const kind = tapeKind(url);
      if (!kind) return this.realFetch.call(globalThis, input, init);
      return this.handle({ kind, url, init, input });
    };
    return () => {
      globalThis.fetch = this.realFetch;
    };
  }

  async handle({ kind, url, init, input }) {
    const method = (init?.method ?? input?.method ?? 'POST').toUpperCase();
    const body = init?.body;
    if (typeof body !== 'string' || body === '') {
      return new Response(
        JSON.stringify({
          error: {
            type: UNKEYABLE_REQUEST_ERROR_TYPE,
            message: unkeyableRequestMessage(kind),
          },
        }),
        { status: 499, headers: { 'content-type': 'application/json' } },
      );
    }
    const key = requestKey({ method, url, body });
    const entry = this.tapes[kind].entries[key];

    if (entry) {
      this.stats.hits += 1;
      this.used[kind].add(key);
      return new Response(JSON.stringify(entry.response), {
        status: entry.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (this.mode === 'offline') {
      if (!this.stats.misses.some((miss) => miss.key === key)) {
        this.stats.misses.push({ kind, key, summary: summarizeRequest(kind, body) });
      }
      // Returned rather than thrown. A thrown fetch reads to the SDK as a
      // connection failure, so it retries twice and reports its own timeout
      // wording, burying the one line that says what to do. A 499 is not in the
      // SDK's retry set, so the miss surfaces once, with this message attached.
      return new Response(
        JSON.stringify({ error: { type: TAPE_MISS_ERROR_TYPE, message: tapeMissMessage(kind, key) } }),
        { status: 499, headers: { 'content-type': 'application/json' } },
      );
    }

    const response = await this.realFetch.call(globalThis, input, init);
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`[rag:eval] ${kind} response was not JSON (status ${response.status}).`);
    }

    if (response.ok) {
      this.tapes[kind].entries[key] = {
        status: response.status,
        // Kept for a human reading the tape; never part of the key.
        recorded_at: new Date().toISOString(),
        request_summary: summarizeRequest(kind, body),
        response: parsed,
      };
      this.stats.recorded += 1;
      this.used[kind].add(key);
    }

    return new Response(text, {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export const TAPE_MISS_ERROR_TYPE = 'rag_eval_tape_miss';

export const UNKEYABLE_REQUEST_ERROR_TYPE = 'rag_eval_unkeyable_request';

export function unkeyableRequestMessage(kind) {
  return (
    `A ${kind} request arrived with no string body, so it cannot be keyed. ` +
    'A request is identified by its canonicalized body, so keying one without a body ' +
    'would collide every request onto a single entry: offline mode would score every ' +
    'case against one recording, and a live run would overwrite that one entry with ' +
    'each response in turn. The OpenAI SDK sends a string body today; an SDK that ' +
    'sends a Request object or a stream is what this catches.'
  );
}

export function tapeMissMessage(kind, key) {
  return (
    `No recorded ${kind} response for request ${key}. ` +
    'Offline mode replays committed tapes, and a miss means the request changed - ' +
    'a prompt, vocabulary, retrieval or golden-case edit is expected to do this. ' +
    'Re-record with `npm run rag:eval -- --live` (needs OPENAI_API_KEY) and commit ' +
    'tests/fixtures/rag-eval/recordings/ alongside the change.'
  );
}

/**
 * A short, human-readable note on the file so a reviewer can tell which case an
 * entry belongs to without re-deriving the hash. Deliberately excluded from the
 * key: it is a comment, and a comment must never decide cache identity.
 */
function summarizeRequest(kind, body) {
  try {
    const parsed = JSON.parse(body);
    if (kind === 'embeddings') {
      return String(parsed.input ?? '').slice(0, 120).replace(/\s+/g, ' ');
    }
    const userMessage = (parsed.messages ?? []).find((m) => m.role === 'user');
    return String(userMessage?.content ?? '').slice(0, 120).replace(/\s+/g, ' ');
  } catch {
    return '';
  }
}
