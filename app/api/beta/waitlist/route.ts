import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { normalizeBetaEmail } from '@/lib/beta';
import { getBetaFormRateLimitSecret } from '@/lib/env.server';
import { readBoundedJson } from '@/lib/http/bounded-json';
import { createAdminClient } from '@/lib/supabase/admin';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowed = {
  vehicle_interest: new Set(['motorcycle', 'car', 'both']),
  activity_type: new Set(['track_day', 'hpde', 'club_racing']),
  experience_level: new Set(['beginner', 'intermediate', 'advanced']),
  current_tracking_method: new Set(['paper', 'phone_notes', 'spreadsheet', 'other_app', 'none']),
  upcoming_track_days: new Set(['zero', 'one', 'two_or_more']),
};

function trustedClientIdentifier(request: Request): string {
  const vercelForwarded = request.headers.get('x-vercel-forwarded-for');
  const developmentForwarded = process.env.VERCEL
    ? null
    : request.headers.get('x-forwarded-for');
  return (vercelForwarded ?? developmentForwarded)?.split(',')[0]?.trim() || 'unknown';
}

async function rateLimited(
  admin: ReturnType<typeof createAdminClient>,
  request: Request,
): Promise<{ limited: boolean; error: string | null }> {
  const key = createHmac('sha256', getBetaFormRateLimitSecret())
    .update(`waitlist:${trustedClientIdentifier(request)}`)
    .digest('hex');
  const { data, error } = await admin.rpc('consume_beta_rate_limit', {
    p_key_hash: key,
    p_limit: 5,
    p_window_seconds: 3600,
  });
  return { limited: data === true, error: error?.message ?? null };
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  const rateLimit = await rateLimited(admin, request);
  if (rateLimit.error) {
    console.error('[beta/waitlist] rate-limit lookup failed', { error: rateLimit.error });
    return NextResponse.json({ ok: false, error: 'Unable to join right now.' }, { status: 500 });
  }
  if (rateLimit.limited) return NextResponse.json({ ok: false, error: 'Too many requests. Try again later.' }, { status: 429 });

  const parsed = await readBoundedJson(request, 20_000);
  if (!parsed.ok && parsed.reason === 'too_large') return NextResponse.json({ ok: false, error: 'Request too large.' }, { status: 413 });
  if (!parsed.ok) return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 });
  const input = parsed.value;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ ok: false, error: 'Request body must be an object.' }, { status: 400 });
  const body = input as Record<string, unknown>;
  if (body.website) return NextResponse.json({ ok: true });
  const email = typeof body.email === 'string' ? normalizeBetaEmail(body.email) : '';
  if (!EMAIL.test(email) || email.length > 254) return NextResponse.json({ ok: false, error: 'Enter a valid email.' }, { status: 400 });
  for (const [key, values] of Object.entries(allowed)) {
    if (typeof body[key] !== 'string' || !values.has(body[key] as string)) return NextResponse.json({ ok: false, error: `Invalid ${key}.` }, { status: 400 });
  }
  if (body.consent !== true) return NextResponse.json({ ok: false, error: 'Consent is required.' }, { status: 400 });
  const optionalContext = typeof body.optional_context === 'string' ? body.optional_context.trim() : '';
  if (optionalContext.length > 500) return NextResponse.json({ ok: false, error: 'Context must be at most 500 characters.' }, { status: 400 });

  const { error } = await admin.from('beta_waitlist').upsert({
    email,
    email_normalized: email,
    vehicle_interest: body.vehicle_interest as 'motorcycle' | 'car' | 'both',
    activity_type: body.activity_type as 'track_day' | 'hpde' | 'club_racing',
    experience_level: body.experience_level as 'beginner' | 'intermediate' | 'advanced',
    current_tracking_method: body.current_tracking_method as 'paper' | 'phone_notes' | 'spreadsheet' | 'other_app' | 'none',
    upcoming_track_days: body.upcoming_track_days as 'zero' | 'one' | 'two_or_more',
    optional_context: optionalContext || null,
    consent_at: new Date().toISOString(),
  }, { onConflict: 'email_normalized' });
  if (error) return NextResponse.json({ ok: false, error: 'Unable to join right now.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
