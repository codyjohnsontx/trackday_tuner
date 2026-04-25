#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function loadEnvFile(filename) {
  const filePath = path.join(repoRoot, filename);
  if (!existsSync(filePath)) return;

  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] !== undefined) continue;

    let normalized = value.trim();
    if (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
      normalized = normalized.slice(1, -1);
    }
    process.env[key] = normalized;
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[ai:requests] Missing environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    limit: 20,
    userId: null,
    status: null,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') {
      const raw = argv[i + 1];
      const parsed = Number(raw);
      if (!raw || !Number.isInteger(parsed) || parsed <= 0) {
        console.error('[ai:requests] --limit must be a positive integer.');
        process.exit(1);
      }
      options.limit = parsed;
      i += 1;
      continue;
    }
    if (arg === '--user') {
      options.userId = argv[i + 1] ?? null;
      if (!options.userId) {
        console.error('[ai:requests] --user requires a value.');
        process.exit(1);
      }
      i += 1;
      continue;
    }
    if (arg === '--status') {
      options.status = argv[i + 1] ?? null;
      if (!options.status) {
        console.error('[ai:requests] --status requires a value.');
        process.exit(1);
      }
      i += 1;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    console.error(`[ai:requests] Unknown argument: ${arg}`);
    process.exit(1);
  }

  return options;
}

function compactList(values) {
  if (!Array.isArray(values) || values.length === 0) return '-';
  return values.join(',');
}

function preview(value, max = 80) {
  if (!value) return '-';
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log('[ai:requests] No matching rows.');
    return;
  }

  const header = [
    pad('created', 20),
    pad('status', 34),
    pad('reason', 28),
    pad('policy', 18),
    pad('stage', 12),
    'preview',
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of rows) {
    console.log(
      [
        pad(row.created_at.replace('T', ' ').slice(0, 19), 20),
        pad(row.status ?? '-', 34),
        pad(row.refusal_reason ?? '-', 28),
        pad(row.policy_result ?? '-', 18),
        pad(row.classifier_stage ?? '-', 12),
        preview(row.prompt_redacted_preview),
      ].join(' '),
    );
    console.log(
      `  fingerprint=${preview(row.prompt_fingerprint, 24)} policy_violations=${compactList(row.policy_violations)} latency=${row.latency_ms ?? '-'} model=${row.model ?? '-'} request_id=${row.request_id}`,
    );
    if (row.error_message) {
      console.log(`  error=${preview(row.error_message, 120)}`);
    }
  }
}

function isMissingColumnError(message) {
  return typeof message === 'string' && message.includes('does not exist');
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const options = parseArgs(process.argv.slice(2));
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const fullSelect =
    'created_at,user_id,session_id,request_id,status,refusal_reason,policy_result,policy_violations,classifier_stage,prompt_fingerprint,prompt_redacted_preview,model,latency_ms,error_message';
  const fallbackSelect =
    'created_at,user_id,session_id,request_id,status,model,latency_ms,error_message';

  let query = supabase
    .from('ai_requests')
    .select(fullSelect)
    .order('created_at', { ascending: false })
    .limit(options.limit);

  if (options.userId) {
    query = query.eq('user_id', options.userId);
  }
  if (options.status) {
    query = query.eq('status', options.status);
  }

  let { data, error } = await query;
  if (error && isMissingColumnError(error.message)) {
    console.warn(
      '[ai:requests] Observability columns are missing. Apply the ai_requests observability migration to see refusal/policy metadata.',
    );

    query = supabase
      .from('ai_requests')
      .select(fallbackSelect)
      .order('created_at', { ascending: false })
      .limit(options.limit);

    if (options.userId) {
      query = query.eq('user_id', options.userId);
    }
    if (options.status) {
      query = query.eq('status', options.status);
    }

    const fallbackResult = await query;
    data = fallbackResult.data?.map((row) => ({
      ...row,
      refusal_reason: null,
      policy_result: null,
      policy_violations: [],
      classifier_stage: null,
      prompt_fingerprint: null,
      prompt_redacted_preview: null,
    }));
    error = fallbackResult.error;
  }

  if (error) {
    console.error('[ai:requests] Query failed:', error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  printTable(rows);
}

main().catch((error) => {
  console.error('[ai:requests]', error);
  process.exit(1);
});
