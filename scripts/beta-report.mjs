#!/usr/bin/env node
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
function required(name) { const value = process.env[name]?.trim(); if (!value) { console.error(`[beta:report] Missing ${name}.`); process.exit(1); } return value; }
const supabase = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const [{ data: profiles, error: profileError }, { data: sessions, error: sessionError }, { data: outcomes, error: outcomeError }, { data: feedback, error: feedbackError }] = await Promise.all([
  supabase.from('profiles').select('id,beta_cohort,beta_access_started_at').not('beta_cohort', 'is', null),
  supabase.from('sessions').select('user_id,date'),
  supabase.from('session_feedback').select('user_id,recommendation_id,outcome'),
  supabase.from('beta_feedback').select('user_id,comparison_usefulness,ai_guidance_usefulness,disappointment,interview_opt_in'),
]);
const error = profileError ?? sessionError ?? outcomeError ?? feedbackError;
if (error) { console.error(`[beta:report] ${error.message}`); process.exit(1); }
const betaIds = new Set((profiles ?? []).map((row) => row.id));
const daysByUser = new Map();
for (const row of sessions ?? []) if (betaIds.has(row.user_id)) { const dates = daysByUser.get(row.user_id) ?? new Set(); dates.add(row.date); daysByUser.set(row.user_id, dates); }
const activated = [...daysByUser.values()].filter((dates) => dates.size >= 1).length;
const retained = [...daysByUser.values()].filter((dates) => dates.size >= 2).length;
const betaOutcomes = (outcomes ?? []).filter((row) => betaIds.has(row.user_id));
const linked = betaOutcomes.filter((row) => row.recommendation_id).length;
const surveys = (feedback ?? []).filter((row) => betaIds.has(row.user_id));
const average = (key) => surveys.length ? (surveys.reduce((sum, row) => sum + row[key], 0) / surveys.length).toFixed(1) : '—';
const veryDisappointed = surveys.length ? Math.round(100 * surveys.filter((row) => row.disappointment === 'very').length / surveys.length) : 0;
const invited = betaIds.size;
console.log('Founding Beta Decision Report');
console.table([
  { metric: 'Accepted riders', actual: invited, target: 12 },
  { metric: 'Logged ≥1 track day', actual: activated, target: 8 },
  { metric: 'Logged ≥2 track days', actual: retained, target: 8 },
  { metric: 'Outcomes saved', actual: betaOutcomes.length, target: 'directional' },
  { metric: 'AI recs linked to outcomes', actual: linked, target: 'directional' },
  { metric: 'Comparison usefulness', actual: average('comparison_usefulness'), target: '≥4.0' },
  { metric: 'AI guidance usefulness', actual: average('ai_guidance_usefulness'), target: '≥4.0' },
  { metric: 'Very disappointed', actual: `${veryDisappointed}%`, target: '≥40%' },
]);
const continueGate = invited >= 12 && retained >= 8 && Number(average('comparison_usefulness')) >= 4 && veryDisappointed >= 40;
console.log(`Decision signal: ${continueGate ? 'CONTINUE — gate met' : 'LEARN — gate not yet met'}`);
