#!/usr/bin/env node
/**
 * `npm run ai:export-replay` - writes riders' kept AI question text, with the
 * verdict each request got, to a JSONL file for Redline's replay runner.
 *
 * Owner-run, with the service key from `.env.local`. Never from CI and never
 * from Redline's own project. docs/ai-replay-export.md is the runbook and the
 * contract both sides test against; change a field here and change it there.
 *
 * It reads the `ai_replay_export` view and nothing else, because the view is
 * where the rule for what may leave the database is written (20260927002000):
 * only text riders chose to keep, written after their latest opt-in, and not
 * yet past its retain_until.
 *
 * Every run is a whole snapshot of what the view holds, never a window: Redline
 * replaces its copy with the newest file, so a question a rider deleted or
 * stopped keeping leaves Redline at the next export. The view is read in pages,
 * and a row can leave it while later pages are read, so `collectSnapshot`
 * checks every collected request against the view once more at the end and
 * drops any that left: the file is what the view allows when that check ran.
 * Nothing is written until then. The file is built beside the target under a
 * temporary name and linked into place only when it is whole, so an
 * interrupted run never leaves a file at the path it was given.
 *
 * WHAT NEVER LEAVES: user_id, session_id and vehicle_id. The view carries none
 * of them, and `toReplayRecord` builds each line from named fields rather than
 * copying a row, so a wider select could not leak one either. The rider is
 * `rider_key` re-keyed with an HMAC under a secret made for this run and never
 * written anywhere, so one export groups a rider's requests.
 *
 * What still ties a line to an account is its `request_id`, kept on purpose so
 * the owner can look a verdict up again. It is Track Tuner's own id for the
 * request: the database maps it to the account, the rider's own app shows it
 * in the Race Engineer answer, and the operational logs record it. It is the
 * same in every export, so it also joins two files; only one is ever kept.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, openSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './lib/env.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const TAG = '[ai:export-replay]';

/** Bumped whenever a field of a line changes meaning or shape. */
export const REPLAY_FORMAT_VERSION = 1;

const PAGE_SIZE = 500;

/** Request ids per final-check query, kept short enough for a URL. */
const RECHECK_CHUNK = 100;

/**
 * The `submitted` keys each route stores (`buildSubmittedText` in
 * lib/rag/ai-request-log.ts). Anything else in the jsonb is dropped rather than
 * copied, so a key nobody put in the contract cannot reach Redline.
 */
const SUBMITTED_KEYS = {
  tuning_advice: ['question', 'symptoms', 'change_intent'],
  day_plan: ['track_name', 'weather_condition', 'surface_condition', 'target_date'],
};

const VIEW_COLUMNS = [
  'request_id',
  'route',
  'created_at',
  'retain_until',
  'submitted',
  'redaction_version',
  'rider_key',
  'app_commit',
  'status',
  'refusal_reason',
  'policy_result',
  'policy_violations',
  'classifier_stage',
  'model',
].join(',');

/** A fresh secret for one export. Never written, logged or returned to the caller's output. */
export function newPseudonymKey() {
  return randomBytes(32);
}

export function pseudonymFor(riderKey, key) {
  return createHmac('sha256', key).update(riderKey).digest('hex');
}

function pickSubmitted(route, submitted) {
  const keys = SUBMITTED_KEYS[route];
  if (!keys) throw new Error(`request has an unknown route: ${route}`);
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
    throw new Error('request has no submitted object');
  }
  const picked = {};
  for (const name of keys) {
    picked[name] = Object.hasOwn(submitted, name) ? submitted[name] : null;
  }
  return picked;
}

/**
 * One view row to one JSONL record. Pure, so the unit suite can hold it to
 * the contract without a database.
 */
export function toReplayRecord(row, key) {
  if (typeof row.rider_key !== 'string' || row.rider_key.length === 0) {
    throw new Error(`request ${row.request_id} has no rider_key`);
  }
  return {
    format_version: REPLAY_FORMAT_VERSION,
    request_id: row.request_id,
    route: row.route,
    created_at: row.created_at,
    retain_until: row.retain_until,
    app_commit: row.app_commit ?? null,
    rider: pseudonymFor(row.rider_key, key),
    submitted: pickSubmitted(row.route, row.submitted),
    redaction_version: row.redaction_version,
    verdict: {
      status: row.status,
      refusal_reason: row.refusal_reason ?? null,
      policy_result: row.policy_result ?? null,
      policy_violations: Array.isArray(row.policy_violations) ? row.policy_violations : [],
      classifier_stage: row.classifier_stage ?? null,
    },
    model: row.model ?? null,
  };
}

function fail(message) {
  console.error(`${TAG} ${message}`);
  process.exit(1);
}

/**
 * `--out` is required: rider text is not printed to a terminal, where
 * scrollback and shell logs would keep it past its 90 days.
 */
export function parseArgs(argv) {
  const options = { out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--out') {
      if (!value || value.startsWith('-')) fail('--out requires a file path.');
      options.out = value;
      i += 1;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  if (!options.out) fail('--out <file.jsonl> is required.');
  return options;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Missing environment variable: ${name}`);
  return value;
}

export async function* viewRows(supabase, pageSize = PAGE_SIZE) {
  let last = null;
  for (;;) {
    let query = supabase
      .from('ai_replay_export')
      .select(VIEW_COLUMNS)
      .order('created_at', { ascending: true })
      .order('request_id', { ascending: true })
      .limit(pageSize);
    if (last) {
      query = query.or(
        `created_at.gt."${last.created_at}",and(created_at.eq."${last.created_at}",request_id.gt.${last.request_id})`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(`reading ai_replay_export failed: ${error.message}`);
    yield* data;
    if (data.length < pageSize) return;
    last = data[data.length - 1];
  }
}

/**
 * Of `requestIds`, the ones the view still holds now. A row leaves the view
 * when it passes retain_until, is purged, or its rider deletes it, turns
 * keeping off or deletes their account.
 */
async function stillInView(supabase, requestIds) {
  const kept = new Set();
  for (let i = 0; i < requestIds.length; i += RECHECK_CHUNK) {
    const chunk = requestIds.slice(i, i + RECHECK_CHUNK);
    const { data, error } = await supabase
      .from('ai_replay_export')
      .select('request_id')
      .in('request_id', chunk);
    if (error) throw new Error(`re-checking ai_replay_export failed: ${error.message}`);
    for (const row of data) kept.add(row.request_id);
  }
  return kept;
}

/**
 * Every row the view holds, as of a final check made after the last page was
 * read. Paging alone is not a snapshot: each page is its own request, so a row
 * read on page 1 can have left the view by the time page 2 arrives, and
 * without this pass it would be exported anyway.
 */
export async function collectSnapshot(supabase, pageSize = PAGE_SIZE) {
  const rows = [];
  for await (const row of viewRows(supabase, pageSize)) rows.push(row);
  const kept = await stillInView(
    supabase,
    rows.map((row) => row.request_id),
  );
  const snapshot = rows.filter((row) => kept.has(row.request_id));
  return { rows: snapshot, dropped: rows.length - snapshot.length };
}

/**
 * Writes `lines` to a temporary file beside `out` and links it into place, so
 * `out` exists only once it is whole. The link refuses an `out` that already
 * exists, and an error part way removes the temporary file. Everything here is
 * synchronous, so no signal handler can run before it returns: the listeners
 * only hold off the default kill, which would leave the temporary file behind,
 * and a Ctrl-C arriving meanwhile is dropped and the file is published whole.
 */
function publish(out, lines) {
  const dir = path.dirname(path.resolve(out));
  const temp = path.join(dir, `.${path.basename(out)}.${randomBytes(6).toString('hex')}.partial`);
  const removeTemp = () => {
    try {
      unlinkSync(temp);
    } catch {
      // Already gone.
    }
  };
  const holdSignal = () => {};
  process.on('SIGINT', holdSignal);
  process.on('SIGTERM', holdSignal);

  try {
    const fd = openSync(temp, 'wx', 0o600);
    try {
      for (const line of lines) writeSync(fd, `${line}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    linkSync(temp, out);
  } finally {
    removeTemp();
    process.removeListener('SIGINT', holdSignal);
    process.removeListener('SIGTERM', holdSignal);
  }
}

async function main() {
  loadEnvFiles(repoRoot);
  const options = parseArgs(process.argv.slice(2));
  // Checked again by the link at the end; this only saves reading the view
  // for a run that could never publish.
  if (existsSync(options.out)) fail(`cannot create ${options.out}: it already exists`);

  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const key = newPseudonymKey();
  const { rows, dropped } = await collectSnapshot(supabase);
  const records = rows.map((row) => toReplayRecord(row, key));

  try {
    publish(
      options.out,
      records.map((record) => JSON.stringify(record)),
    );
  } catch (error) {
    fail(`cannot create ${options.out}: ${error.message}`);
  }

  const counts = { tuning_advice: 0, day_plan: 0 };
  let earliestRetainUntil = null;
  for (const record of records) {
    counts[record.route] += 1;
    if (!earliestRetainUntil || record.retain_until < earliestRetainUntil) {
      earliestRetainUntil = record.retain_until;
    }
  }

  console.error(
    `${TAG} Wrote ${records.length} requests to ${options.out} (tuning_advice=${counts.tuning_advice}, day_plan=${counts.day_plan}).`,
  );
  if (dropped > 0) {
    console.error(`${TAG} Left out ${dropped} that stopped being exportable while the export ran.`);
  }
  console.error(`${TAG} Redline replaces its whole copy with this file and deletes the previous one.`);
  if (earliestRetainUntil) {
    console.error(`${TAG} The earliest row must be deleted from every copy by ${earliestRetainUntil}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(TAG, error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
