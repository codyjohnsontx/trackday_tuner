import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// docs/beta-runbook.md carries a copy of 20260926001900 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand - the
// arrangement tests/unit/hosted-ai-request-text-runbook.test.ts guards for the
// table these triggers protect. A copy that lost the FOR SHARE, or read
// requires_opt_in as consent, would let a question in flight keep text the
// rider had just been told was deleted.
//
// Text only, like its twins: the runbook's verification query is what answers
// whether the block ran.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const migration = readFileSync(
  path.join(root, 'supabase/migrations/20260926001900_guard_rider_text_capture_at_write.sql'),
  'utf8',
);
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER =
  '-- hosted-capture-keep-rule: mirror of supabase/migrations/20260926001900_guard_rider_text_capture_at_write.sql';
const ROLLBACK_MARKER = '-- hosted-capture-keep-rule-rollback';

// Split on `;` on both sides alike, so the function body splits identically in
// each and still has to match line for line.
function statements(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((statement) => statement.length > 0);
}

function fencedBlock(markdown: string, marker: string): string {
  const start = markdown.indexOf(marker);
  if (start === -1) throw new Error(`docs/beta-runbook.md has no block opening with ${marker}`);
  const end = markdown.indexOf('\n```', start);
  if (end === -1) throw new Error(`the block opening with ${marker} never closes`);
  return markdown.slice(start, end);
}

describe('the hosted capture keep-rule block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  it('keeps the rollback a transaction that drops both triggers before their function', () => {
    const rollback = statements(fencedBlock(runbook, ROLLBACK_MARKER));

    expect(rollback).toEqual([
      'begin',
      'drop trigger if exists ai_request_text_enforce_keep_rule on public.ai_request_text',
      'drop trigger if exists ai_requests_enforce_keep_rule on public.ai_requests',
      'drop function if exists public.enforce_rider_text_keep_rule()',
      'commit',
    ]);
  });
});
