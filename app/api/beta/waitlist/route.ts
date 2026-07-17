import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { normalizeBetaEmail } from '@/lib/beta';
import { getBetaFormRateLimitSecret } from '@/lib/env.server';
import { createAdminClient } from '@/lib/supabase/admin';

const attempts = new Map<string, { count: number; resetAt: number }>();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowed = {
  vehicle_interest: new Set(['motorcycle', 'car', 'both']),
  activity_type: new Set(['track_day', 'hpde', 'club_racing']),
  experience_level: new Set(['beginner', 'intermediate', 'advanced']),
  current_tracking_method: new Set(['paper', 'phone_notes', 'spreadsheet', 'other_app', 'none']),
  upcoming_track_days: new Set(['zero', 'one', 'two_or_more']),
};

function rateLimited(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = createHmac('sha256', getBetaFormRateLimitSecret()).update(forwarded).digest('hex');
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  return current.count > 5;
}

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 20_000) return NextResponse.json({ ok: false, error: 'Request too large.' }, { status: 413 });
  if (rateLimited(request)) return NextResponse.json({ ok: false, error: 'Too many requests. Try again later.' }, { status: 429 });

  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 }); }
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

  const admin = createAdminClient();
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
