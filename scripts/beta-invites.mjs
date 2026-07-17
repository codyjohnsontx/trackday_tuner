#!/usr/bin/env node
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const filename of ['.env.local', '.env']) {
  const filePath = path.resolve(process.cwd(), filename);
  if (!existsSync(filePath)) continue;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) { console.error(`[beta:invite] Missing ${name}.`); process.exit(1); }
  return value;
}

const [command, rawEmail, ...args] = process.argv.slice(2);
if (command !== 'create' || !rawEmail) {
  console.error('Usage: npm run beta:invite -- create rider@example.com [--days 14] [--cohort motorcycle-founding]');
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('[beta:invite] Invalid email.'); process.exit(1); }
let days = 14;
let cohort = 'motorcycle-founding';
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--days') { days = Number(args[++index]); continue; }
  if (args[index] === '--cohort') { cohort = args[++index] ?? ''; continue; }
  console.error(`[beta:invite] Unknown argument: ${args[index]}`); process.exit(1);
}
if (!Number.isInteger(days) || days < 1 || days > 90 || !cohort || cohort.length > 80) { console.error('[beta:invite] Invalid days or cohort.'); process.exit(1); }

const secret = required('BETA_INVITE_SECRET');
const supabase = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const code = randomBytes(12).toString('base64url');
const codeHash = createHmac('sha256', secret).update(code).digest('hex');
const expires = new Date(); expires.setUTCDate(expires.getUTCDate() + days);
const { data: waitlist } = await supabase.from('beta_waitlist').select('id').eq('email_normalized', email).maybeSingle();
const { error } = await supabase.from('beta_invites').insert({ waitlist_id: waitlist?.id ?? null, email_normalized: email, code_hash: codeHash, cohort, expires_at: expires.toISOString() });
if (error) { console.error(`[beta:invite] ${error.message}`); process.exit(1); }
if (waitlist) await supabase.from('beta_waitlist').update({ status: 'invited' }).eq('id', waitlist.id);
console.log(`Invitation created for ${email}`);
console.log(`Code: ${code}`);
console.log(`Expires: ${expires.toISOString()}`);
console.log('This plaintext code is shown once. Send it to the matching email owner through your chosen channel.');
