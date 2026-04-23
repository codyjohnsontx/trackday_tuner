import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { createClient } from '@/lib/supabase/server';
import type { FeedbackOutcome, Json, RaceEngineerMemory, Session } from '@/types';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const OUTCOMES = new Set<FeedbackOutcome>(['better', 'same', 'worse', 'unknown']);
const MAX_SYMPTOMS = 50;

interface FeedbackRequest {
  session_id: string;
  vehicle_id: string;
  recommendation_id?: string;
  outcome: FeedbackOutcome;
  rider_confidence?: number;
  symptoms?: string[];
  notes?: string;
  lap_time_delta_ms?: number;
}

type ValidationResult =
  | { ok: true; data: FeedbackRequest }
  | { ok: false; error: string };

function errorResponse(status: number, error: string, requestId: string) {
  return NextResponse.json(
    { ok: false, error, request_id: requestId },
    { status, headers: { 'x-request-id': requestId } },
  );
}

function validateFeedbackRequest(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const record = input as Record<string, unknown>;
  const allowed = new Set([
    'session_id',
    'vehicle_id',
    'recommendation_id',
    'outcome',
    'rider_confidence',
    'symptoms',
    'notes',
    'lap_time_delta_ms',
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return { ok: false, error: `Unknown field: ${key}.` };
  }

  if (typeof record.session_id !== 'string' || !UUID_PATTERN.test(record.session_id)) {
    return { ok: false, error: 'session_id must be a UUID.' };
  }
  if (typeof record.vehicle_id !== 'string' || !UUID_PATTERN.test(record.vehicle_id)) {
    return { ok: false, error: 'vehicle_id must be a UUID.' };
  }
  if (
    record.recommendation_id !== undefined &&
    (typeof record.recommendation_id !== 'string' || !UUID_PATTERN.test(record.recommendation_id))
  ) {
    return { ok: false, error: 'recommendation_id must be a UUID.' };
  }
  if (typeof record.outcome !== 'string' || !OUTCOMES.has(record.outcome as FeedbackOutcome)) {
    return { ok: false, error: 'outcome must be better, same, worse, or unknown.' };
  }

  let riderConfidence: number | undefined;
  if (record.rider_confidence !== undefined) {
    if (
      typeof record.rider_confidence !== 'number' ||
      !Number.isInteger(record.rider_confidence) ||
      record.rider_confidence < 1 ||
      record.rider_confidence > 5
    ) {
      return { ok: false, error: 'rider_confidence must be an integer from 1 to 5.' };
    }
    riderConfidence = record.rider_confidence;
  }

  let symptoms: string[] | undefined;
  if (record.symptoms !== undefined) {
    if (!Array.isArray(record.symptoms)) {
      return { ok: false, error: 'symptoms must be an array of strings.' };
    }
    if (record.symptoms.length > MAX_SYMPTOMS) {
      return { ok: false, error: `symptoms cannot exceed ${MAX_SYMPTOMS} entries.` };
    }
    symptoms = [];
    for (const symptom of record.symptoms) {
      if (typeof symptom !== 'string') return { ok: false, error: 'symptoms must be strings.' };
      const trimmed = symptom.trim();
      if (trimmed.length > 64) return { ok: false, error: 'symptom entries must be at most 64 characters.' };
      if (trimmed) symptoms.push(trimmed);
    }
  }

  const notes = typeof record.notes === 'string' ? record.notes.trim() : undefined;
  if (notes && notes.length > 1000) {
    return { ok: false, error: 'notes must be at most 1000 characters.' };
  }

  let lapTimeDeltaMs: number | undefined;
  if (record.lap_time_delta_ms !== undefined) {
    if (typeof record.lap_time_delta_ms !== 'number' || !Number.isFinite(record.lap_time_delta_ms)) {
      return { ok: false, error: 'lap_time_delta_ms must be a number.' };
    }
    lapTimeDeltaMs = Math.round(record.lap_time_delta_ms);
  }

  return {
    ok: true,
    data: {
      session_id: record.session_id,
      vehicle_id: record.vehicle_id,
      recommendation_id: record.recommendation_id,
      outcome: record.outcome as FeedbackOutcome,
      rider_confidence: riderConfidence,
      symptoms,
      notes: notes || undefined,
      lap_time_delta_ms: lapTimeDeltaMs,
    },
  };
}

function buildMemorySummary(params: {
  existing: RaceEngineerMemory | null;
  session: Session;
  outcome: FeedbackOutcome;
  symptoms: string[];
  notes?: string;
}): { summary: string; patterns: Json; evidence_count: number } {
  const evidenceCount = (params.existing?.evidence_count ?? 0) + 1;
  const symptomText = params.symptoms.length > 0 ? params.symptoms.join(', ') : 'no structured symptoms';
  const noteText = params.notes ? ` Notes: ${params.notes}` : '';
  const latest = `Latest feedback at ${params.session.track_name ?? 'unknown track'}: ${params.outcome} with ${symptomText}.${noteText}`;
  const prior = params.existing?.summary?.trim();
  const summary = prior ? `${latest}\n${prior}`.slice(0, 1800) : latest;
  const existingPatterns =
    params.existing?.patterns && typeof params.existing.patterns === 'object'
      ? params.existing.patterns
      : {};

  return {
    summary,
    evidence_count: evidenceCount,
    patterns: {
      ...existingPatterns,
      last_feedback: {
        session_id: params.session.id,
        track_name: params.session.track_name,
        outcome: params.outcome,
        symptoms: params.symptoms,
        notes: params.notes ?? null,
        date: params.session.date,
      },
    },
  };
}

async function updateMemory(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  session: Session;
  outcome: FeedbackOutcome;
  symptoms: string[];
  notes?: string;
}): Promise<void> {
  let query = params.supabase
    .from('race_engineer_memory')
    .select('*')
    .eq('user_id', params.userId)
    .eq('vehicle_id', params.session.vehicle_id);

  query = params.session.track_id ? query.eq('track_id', params.session.track_id) : query.is('track_id', null);
  const { data: existingRows } = await query.limit(1);
  const existing = ((existingRows ?? [])[0] ?? null) as RaceEngineerMemory | null;
  const next = buildMemorySummary({
    existing,
    session: params.session,
    outcome: params.outcome,
    symptoms: params.symptoms,
    notes: params.notes,
  });

  const { error: upsertError } = await params.supabase
    .from('race_engineer_memory')
    .upsert(
      {
        id: existing?.id,
        user_id: params.userId,
        vehicle_id: params.session.vehicle_id,
        track_id: params.session.track_id,
        summary: next.summary,
        patterns: next.patterns,
        evidence_count: next.evidence_count,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id,vehicle_id,track_id',
      },
    );
  if (upsertError) {
    console.error('[ai/recommendation-feedback] race_engineer_memory upsert failed', {
      userId: params.userId,
      vehicleId: params.session.vehicle_id,
      trackId: params.session.track_id,
      error: upsertError.message,
    });
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID();

  let parsedJson: unknown;
  try {
    parsedJson = await request.json();
  } catch {
    return errorResponse(400, 'Request body must be valid JSON.', requestId);
  }

  const validated = validateFeedbackRequest(parsedJson);
  if (!validated.ok) {
    return errorResponse(400, validated.error, requestId);
  }

  const user = await getAuthenticatedUser();
  if (!user) return errorResponse(401, 'Not authenticated.', requestId);

  const profile = await getUserProfile();
  if ((profile?.tier ?? 'free') !== 'pro') {
    return errorResponse(402, 'Race Engineer is a Pro feature. Upgrade to continue.', requestId);
  }

  const supabase = await createClient();
  const { data: sessionRow, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', validated.data.session_id)
    .eq('vehicle_id', validated.data.vehicle_id)
    .eq('user_id', user.id)
    .single();

  if (sessionError || !sessionRow) {
    return errorResponse(404, 'Session not found.', requestId);
  }

  const session = sessionRow as Session;
  const symptoms = validated.data.symptoms ?? [];
  const { data: feedbackRow, error: feedbackError } = await supabase
    .from('session_feedback')
    .insert({
      user_id: user.id,
      session_id: session.id,
      vehicle_id: session.vehicle_id,
      track_id: session.track_id,
      recommendation_id: validated.data.recommendation_id ?? null,
      outcome: validated.data.outcome,
      rider_confidence: validated.data.rider_confidence ?? null,
      symptoms,
      notes: validated.data.notes ?? null,
      lap_time_delta_ms: validated.data.lap_time_delta_ms ?? null,
    })
    .select('*')
    .single();

  if (feedbackError) {
    console.error('[ai/recommendation-feedback] feedback insert failed', {
      requestId,
      userId: user.id,
      sessionId: session.id,
      error: feedbackError.message,
    });
    return errorResponse(500, 'Internal server error processing feedback.', requestId);
  }

  if (validated.data.recommendation_id) {
    const recommendationPatch: {
      status?: 'applied' | 'rejected';
      outcome_session_id: string;
      updated_at: string;
    } = {
      outcome_session_id: session.id,
      updated_at: new Date().toISOString(),
    };
    if (validated.data.outcome === 'worse') {
      recommendationPatch.status = 'rejected';
    } else if (validated.data.outcome === 'better' || validated.data.outcome === 'same') {
      recommendationPatch.status = 'applied';
    }

    const { data: recommendationRow, error: recommendationError } = await supabase
      .from('ai_recommendations')
      .update(recommendationPatch)
      .eq('id', validated.data.recommendation_id)
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle();
    if (recommendationError || !recommendationRow) {
      console.error('[ai/recommendation-feedback] ai_recommendations update failed', {
        userId: user.id,
        recommendationId: validated.data.recommendation_id,
        error: recommendationError?.message ?? 'Recommendation row was not updated.',
      });
    }
  }

  await updateMemory({
    supabase,
    userId: user.id,
    session,
    outcome: validated.data.outcome,
    symptoms,
    notes: validated.data.notes,
  });

  return NextResponse.json(
    {
      ok: true,
      request_id: requestId,
      feedback: feedbackRow,
    },
    { status: 200, headers: { 'x-request-id': requestId } },
  );
}
