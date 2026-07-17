import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import { buildSessionExportCsv } from '@/lib/session-export';
import { createClient } from '@/lib/supabase/server';
import type { Session, SessionEnvironment, Vehicle } from '@/types';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function getFilterDate(searchParams: URLSearchParams, key: string): string | null {
  const value = searchParams.get(key);
  if (!value) return null;
  return datePattern.test(value) ? value : null;
}

function todayFileDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const profile = await getUserProfile();
  if (!resolveUserAccess(profile).hasProAccess) {
    return NextResponse.json({ error: 'CSV export requires Pro.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const vehicleId = url.searchParams.get('vehicleId');
  const from = getFilterDate(url.searchParams, 'from');
  const to = getFilterDate(url.searchParams, 'to');
  const supabase = await createClient();

  let sessionsQuery = supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false });

  if (vehicleId) {
    sessionsQuery = sessionsQuery.eq('vehicle_id', vehicleId);
  }
  if (from) {
    sessionsQuery = sessionsQuery.gte('date', from);
  }
  if (to) {
    sessionsQuery = sessionsQuery.lte('date', to);
  }

  const [{ data: sessionsData, error: sessionsError }, { data: vehiclesData, error: vehiclesError }] =
    await Promise.all([
      sessionsQuery,
      supabase.from('vehicles').select('*').eq('user_id', user.id),
    ]);

  if (sessionsError || vehiclesError) {
    return NextResponse.json({ error: 'Unable to load sessions for export.' }, { status: 500 });
  }

  const sessions = (sessionsData ?? []) as Session[];
  const sessionIds = sessions.map((session) => session.id);
  const environmentsResult = sessionIds.length > 0
    ? await supabase
        .from('session_environment')
        .select('*')
        .eq('user_id', user.id)
        .in('session_id', sessionIds)
    : { data: [], error: null };

  if (environmentsResult.error) {
    return NextResponse.json({ error: 'Unable to load session environments for export.' }, { status: 500 });
  }

  const vehicles = (vehiclesData ?? []) as Vehicle[];
  const environments = (environmentsResult.data ?? []) as SessionEnvironment[];
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const environmentMap = new Map(environments.map((environment) => [environment.session_id, environment]));
  const csv = buildSessionExportCsv(
    sessions.map((session) => ({
      session,
      vehicle: vehicleMap.get(session.vehicle_id) ?? null,
      environment: environmentMap.get(session.id) ?? null,
    })),
  );

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="trackday-tuner-sessions-${todayFileDate()}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
