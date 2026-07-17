import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { Json, ProductEventName } from '@/types/supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_EVENTS = new Set<ProductEventName>([
  'vehicle_created', 'session_created', 'lap_data_saved', 'comparison_viewed',
  'session_outcome_prompt_viewed', 'session_outcome_saved',
  'recommendation_linked_to_outcome', 'beta_survey_submitted',
]);

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ ok: false, error: 'Invalid event.' }, { status: 400 });
  const body = input as Record<string, unknown>;
  if (typeof body.event_id !== 'string' || !UUID.test(body.event_id)) return NextResponse.json({ ok: false, error: 'Invalid event ID.' }, { status: 400 });
  if (typeof body.event_name !== 'string' || !CLIENT_EVENTS.has(body.event_name as ProductEventName)) return NextResponse.json({ ok: false, error: 'Invalid event name.' }, { status: 400 });
  const sessionId = body.session_id == null ? null : body.session_id;
  const vehicleId = body.vehicle_id == null ? null : body.vehicle_id;
  if ((sessionId !== null && (typeof sessionId !== 'string' || !UUID.test(sessionId))) || (vehicleId !== null && (typeof vehicleId !== 'string' || !UUID.test(vehicleId)))) return NextResponse.json({ ok: false, error: 'Invalid entity ID.' }, { status: 400 });
  const properties = body.properties ?? {};
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties) || JSON.stringify(properties).length > 4000) return NextResponse.json({ ok: false, error: 'Invalid event properties.' }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from('product_events').insert({
    event_id: body.event_id,
    user_id: user.id,
    event_name: body.event_name as ProductEventName,
    session_id: sessionId as string | null,
    vehicle_id: vehicleId as string | null,
    properties: properties as Json,
  });
  if (error && error.code !== '23505') return NextResponse.json({ ok: false, error: 'Unable to record event.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
