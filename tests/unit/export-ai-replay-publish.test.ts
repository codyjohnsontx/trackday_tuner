import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * `npm run ai:export-replay` names a file that is supposed to mean a whole
 * snapshot, so nothing may exist at that path until the export is whole. An
 * interrupted run - a signal, a closed laptop - must leave no file there that
 * an owner could mistake for an export or that a rerun would refuse to
 * replace.
 *
 * These run the real script as a child process against a stand-in for
 * PostgREST, so the signal lands on the real process at the real moment:
 * after the first page was read and while the second is still being fetched.
 */

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/export-ai-replay.mjs');

function viewRow(i: number) {
  return {
    request_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    route: 'tuning_advice',
    created_at: '2026-10-01T12:00:00+00:00',
    retain_until: '2026-12-30T12:00:00+00:00',
    submitted: { question: `Question ${i}`, symptoms: [], change_intent: null },
    redaction_version: 1,
    rider_key: 'a'.repeat(64),
    app_commit: null,
    status: 'ok',
    refusal_reason: null,
    policy_result: 'pass',
    policy_violations: [],
    classifier_stage: null,
    model: null,
  };
}

interface StandIn {
  url: string;
  server: Server;
  secondPageRequested: Promise<void>;
}

/**
 * Serves `firstPage` rows for the first page. With `hangAfterFirstPage` the
 * next page is never answered; otherwise it is empty, and the final check
 * returns every requested id that was served.
 */
async function standIn(firstPage: number, hangAfterFirstPage: boolean): Promise<StandIn> {
  const rows = Array.from({ length: firstPage }, (_, i) => viewRow(i));
  let markSecondPage!: () => void;
  const secondPageRequested = new Promise<void>((resolve) => {
    markSecondPage = resolve;
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://stand-in');
    const inList = url.searchParams.get('request_id');
    let body: unknown[];
    if (inList) {
      const ids = new Set(inList.replace(/^in\.\(|\)$/g, '').split(',').map((id) => id.replace(/"/g, '')));
      body = rows.filter((row) => ids.has(row.request_id)).map((row) => ({ request_id: row.request_id }));
    } else if (url.searchParams.get('or')) {
      markSecondPage();
      if (hangAfterFirstPage) return;
      body = [];
    } else {
      body = rows;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, secondPageRequested };
}

function runExport(url: string, out: string): ChildProcess {
  return spawn(process.execPath, [SCRIPT, '--out', out], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: 'stand-in-service-key',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function exited(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ai-replay-publish-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('npm run ai:export-replay, publishing the file', () => {
  it('leaves nothing at the target path when it is killed part way through reading the view', async () => {
    const view = await standIn(500, true);
    cleanups.push(() => view.server.close());
    const dir = tempDir();
    const out = path.join(dir, 'replay.jsonl');

    const child = runExport(view.url, out);
    const done = exited(child);
    await view.secondPageRequested;
    child.kill('SIGTERM');
    await done;

    expect(readdirSync(dir)).toEqual([]);
  });

  it('puts the whole file at the target path, owner-readable, and nothing beside it', async () => {
    const view = await standIn(3, false);
    cleanups.push(() => view.server.close());
    const dir = tempDir();
    const out = path.join(dir, 'replay.jsonl');

    const child = runExport(view.url, out);
    const { code } = await exited(child);

    expect(code).toBe(0);
    expect(readdirSync(dir)).toEqual(['replay.jsonl']);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const lines = readFileSync(out, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map((line) => line.submitted.question)).toEqual(['Question 0', 'Question 1', 'Question 2']);
  });
});
