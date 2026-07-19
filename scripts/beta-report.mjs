#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './lib/env.mjs';
import {
  GATE_TARGETS,
  computeWithinDayLoops,
  decideGate,
  summarizeAiGuidance,
  summarizeComparisonUsage,
} from './lib/beta-report-metrics.mjs';

loadEnvFiles();
function required(name) { const value = process.env[name]?.trim(); if (!value) { console.error(`[beta:report] Missing ${name}.`); process.exit(1); } return value; }
const supabase = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const [
  { data: profiles, error: profileError },
  { data: sessions, error: sessionError },
  { data: changes, error: changeError },
  { data: outcomes, error: outcomeError },
  { data: feedback, error: feedbackError },
  { data: comparisonEvents, error: eventError },
  { data: aiRequests, error: aiRequestError },
] = await Promise.all([
  supabase.from('profiles').select('id,beta_cohort,beta_access_started_at').not('beta_cohort', 'is', null),
  supabase.from('sessions').select('id,user_id,date,start_time,created_at'),
  supabase.from('session_changes').select('user_id,session_id,changes'),
  supabase.from('session_feedback').select('user_id,session_id,reference_session_id,recommendation_id,outcome'),
  supabase.from('beta_feedback').select('user_id,comparison_usefulness,ai_guidance_usefulness,disappointment,interview_opt_in'),
  supabase.from('product_events').select('user_id,event_name,properties').eq('event_name', 'comparison_viewed'),
  supabase.from('ai_requests').select('user_id,status'),
]);
const error = profileError ?? sessionError ?? changeError ?? outcomeError ?? feedbackError ?? eventError ?? aiRequestError;
if (error) { console.error(`[beta:report] ${error.message}`); process.exit(1); }
const betaIds = new Set((profiles ?? []).map((row) => row.id));
const daysByUser = new Map();
for (const row of sessions ?? []) if (betaIds.has(row.user_id)) { const dates = daysByUser.get(row.user_id) ?? new Set(); dates.add(row.date); daysByUser.set(row.user_id, dates); }
const activated = [...daysByUser.values()].filter((dates) => dates.size >= 1).length;
const retained = [...daysByUser.values()].filter((dates) => dates.size >= 2).length;
const loops = computeWithinDayLoops({ sessions, changes, outcomes, riderIds: betaIds });
const comparisons = summarizeComparisonUsage(comparisonEvents, betaIds);
const aiGuidance = summarizeAiGuidance({ aiRequests, outcomes, riderIds: betaIds });
const betaOutcomes = (outcomes ?? []).filter((row) => betaIds.has(row.user_id));
const linked = betaOutcomes.filter((row) => row.recommendation_id).length;
const surveys = (feedback ?? []).filter((row) => betaIds.has(row.user_id));
const average = (key) => {
  const values = surveys.map((row) => row[key]).filter((value) => typeof value === 'number' && Number.isFinite(value));
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '—';
};
const perRider = (value) => (value === null ? '—' : value.toFixed(1));
const veryDisappointed = surveys.length ? Math.round(100 * surveys.filter((row) => row.disappointment === 'very').length / surveys.length) : 0;
const invited = betaIds.size;
// Per-surface breakdown only once events actually distinguish surfaces
// (properties.surface); today the dedicated compare page is the sole emitter.
const surfaceRows = [...comparisons.bySurface.keys()].some((surface) => surface !== 'unspecified')
  ? [...comparisons.bySurface.entries()].map(([surface, count]) => ({ metric: `Comparison views — ${surface}`, actual: count, target: 'directional' }))
  : [];
console.log('Founding Beta Decision Report');
console.table([
  { metric: 'Accepted riders', actual: invited, target: GATE_TARGETS.acceptedRiders },
  { metric: 'Riders with ≥1 within-day loop', actual: loops.ridersWithLoop, target: GATE_TARGETS.ridersWithLoop },
  { metric: 'Riders with ≥2 within-day loops', actual: loops.ridersWithRepeatLoops, target: GATE_TARGETS.ridersWithRepeatLoops },
  { metric: 'Within-day loops (total)', actual: loops.totalLoops, target: 'directional' },
  { metric: 'Logged ≥1 track day', actual: activated, target: 8 },
  { metric: 'Logged ≥2 track days', actual: retained, target: 'retention signal' },
  { metric: 'Outcomes saved', actual: betaOutcomes.length, target: 'directional' },
  { metric: 'AI recs linked to outcomes', actual: linked, target: 'directional' },
  { metric: 'Comparison views', actual: comparisons.total, target: 'directional' },
  ...surfaceRows,
  { metric: 'Riders with AI guidance', actual: aiGuidance.guidedRiders, target: 'directional' },
  { metric: 'Outcomes per AI-guided rider', actual: perRider(aiGuidance.guidedOutcomeAvg), target: 'directional' },
  { metric: 'Outcomes per rider without AI', actual: perRider(aiGuidance.unguidedOutcomeAvg), target: 'directional' },
  { metric: 'Comparison usefulness', actual: average('comparison_usefulness'), target: '≥4.0' },
  { metric: 'AI guidance usefulness', actual: average('ai_guidance_usefulness'), target: '≥4.0' },
  { metric: 'Very disappointed', actual: `${veryDisappointed}%`, target: '≥40%' },
]);
const continueGate = decideGate({
  acceptedRiders: invited,
  ridersWithLoop: loops.ridersWithLoop,
  ridersWithRepeatLoops: loops.ridersWithRepeatLoops,
  comparisonUsefulness: average('comparison_usefulness'),
  veryDisappointedPct: veryDisappointed,
});
console.log(`Decision signal: ${continueGate ? 'CONTINUE — gate met' : 'LEARN — gate not yet met'}`);
