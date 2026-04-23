'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { getFreePlanLimit, getFreePlanLimitMessage } from '@/lib/plans';
import type { TableInsert } from '@/types/supabase';
import type {
  ActionResult,
  CreateSessionEnvironmentInput,
  CreateSessionInput,
  Session,
  SessionEnvironment,
} from '@/types';

function hasEnvironmentValues(environment: CreateSessionEnvironmentInput | null | undefined): boolean {
  if (!environment) return false;
  return [
    environment.ambient_temperature_c,
    environment.track_temperature_c,
    environment.humidity_percent,
    environment.weather_condition,
    environment.surface_condition,
  ].some((value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    return Boolean(value?.trim());
  });
}

export async function getSessions(vehicleId?: string, limit?: number): Promise<Session[]> {
  const user = await getAuthenticatedUser();
  if (!user) return [];

  const supabase = await createClient();
  let query = supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false });

  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId);
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data } = await query;
  return (data ?? []) as Session[];
}

export async function getSessionCount(vehicleId?: string): Promise<number> {
  const user = await getAuthenticatedUser();
  if (!user) return 0;

  const supabase = await createClient();
  let query = supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId);
  }

  const { count } = await query;
  return count ?? 0;
}

export async function getSession(id: string): Promise<Session | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error) return null;
  return data as Session;
}

export async function getSessionEnvironment(sessionId: string): Promise<SessionEnvironment | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from('session_environment')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .limit(1);

  return (data?.[0] ?? null) as SessionEnvironment | null;
}

export async function getSessionEnvironments(sessionIds: string[]): Promise<SessionEnvironment[]> {
  const user = await getAuthenticatedUser();
  if (!user || sessionIds.length === 0) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('session_environment')
    .select('*')
    .eq('user_id', user.id)
    .in('session_id', sessionIds);

  return (data ?? []) as SessionEnvironment[];
}

export async function getPreviousSession(
  currentSession: Session,
): Promise<Session | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('vehicle_id', currentSession.vehicle_id)
    .neq('id', currentSession.id)
    .or(`date.lt.${currentSession.date},and(date.eq.${currentSession.date},start_time.lt.${currentSession.start_time ?? '23:59:59'})`)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;

  return (data?.[0] ?? null) as Session | null;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<ActionResult<Session>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();

  const profile = await getUserProfile();
  const tier = profile?.tier ?? 'free';

  if (tier === 'free') {
    const { count } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if ((count ?? 0) >= getFreePlanLimit('sessions')) {
      return {
        ok: false,
        error: getFreePlanLimitMessage('sessions'),
      };
    }
  }

  // Denormalize track name if track_id is set but track_name was not provided
  let trackName = input.track_name;
  if (input.track_id && !trackName) {
    const { data: trackData } = await supabase
      .from('tracks')
      .select('name')
      .eq('id', input.track_id)
      .single();
    trackName = trackData?.name ?? null;
  }

  const payload: TableInsert<'sessions'> = {
    user_id: user.id,
    vehicle_id: input.vehicle_id,
    track_id: input.track_id,
    track_name: trackName,
    date: input.date,
    start_time: input.start_time ?? null,
    session_number: input.session_number ?? null,
    conditions: input.conditions,
    tires: input.tires,
    suspension: input.suspension,
    alignment: input.alignment,
    enabled_modules: input.enabled_modules ?? null,
    extra_modules: input.extra_modules ?? null,
    notes: input.notes ?? null,
  };

  const { data, error } = await supabase
    .from('sessions')
    .insert(payload)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  const createdSession = data as Session;

  if (hasEnvironmentValues(input.environment)) {
    const environmentPayload: TableInsert<'session_environment'> = {
      user_id: user.id,
      session_id: createdSession.id,
      ambient_temperature_c: input.environment?.ambient_temperature_c ?? null,
      track_temperature_c: input.environment?.track_temperature_c ?? null,
      humidity_percent: input.environment?.humidity_percent ?? null,
      weather_condition: input.environment?.weather_condition?.trim() || null,
      surface_condition: input.environment?.surface_condition?.trim() || null,
      source: input.environment?.source ?? 'manual',
    };

    const { error: environmentError } = await supabase
      .from('session_environment')
      .insert(environmentPayload);

    if (environmentError) return { ok: false, error: environmentError.message };
  }

  revalidatePath('/sessions');
  revalidatePath('/dashboard');
  return { ok: true, data: createdSession };
}

export async function deleteSession(id: string): Promise<ActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/sessions');
  return { ok: true, data: undefined };
}
