import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { betaAccessWindow, hashBetaInviteCode, normalizeBetaEmail } from '@/lib/beta';
import { isBetaInviteOnly } from '@/lib/env.server';
import { createAdminClient } from '@/lib/supabase/admin';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!isBetaInviteOnly()) {
    return NextResponse.json({ ok: false, error: 'Invitation signup is not enabled.' }, { status: 404 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return NextResponse.json({ ok: false, error: 'Request body must be an object.' }, { status: 400 });
  }

  const body = input as Record<string, unknown>;
  const email = typeof body.email === 'string' ? normalizeBetaEmail(body.email) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const code = typeof body.invite_code === 'string' ? body.invite_code.trim() : '';
  if (!EMAIL.test(email) || email.length > 254) {
    return NextResponse.json({ ok: false, error: 'Enter a valid email.' }, { status: 400 });
  }
  if (password.length < 8 || password.length > 72) {
    return NextResponse.json({ ok: false, error: 'Password must be 8–72 characters.' }, { status: 400 });
  }
  if (!code || code.length > 200) {
    return NextResponse.json({ ok: false, error: 'Enter a valid invitation code.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const { data: invite } = await admin
    .from('beta_invites')
    .select('*')
    .eq('code_hash', hashBetaInviteCode(code))
    .eq('email_normalized', email)
    .eq('status', 'active')
    .gt('expires_at', now.toISOString())
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ ok: false, error: 'That invitation is invalid or has expired.' }, { status: 400 });
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !created.user) {
    return NextResponse.json({ ok: false, error: 'Unable to create this account.' }, { status: 400 });
  }

  const userId = created.user.id;
  const access = betaAccessWindow(now);
  const { error: profileError } = await admin.from('profiles').upsert({
    id: userId,
    tier: 'free',
    beta_cohort: invite.cohort,
    beta_access_started_at: access.startedAt,
    beta_access_expires_at: access.expiresAt,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ ok: false, error: 'Unable to finish account setup.' }, { status: 500 });
  }

  const { data: redeemedInvite, error: redeemError } = await admin
    .from('beta_invites')
    .update({ status: 'redeemed', redeemed_at: now.toISOString(), redeemed_by: userId })
    .eq('id', invite.id)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();

  if (redeemError || !redeemedInvite) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ ok: false, error: 'That invitation was already used.' }, { status: 409 });
  }

  if (invite.waitlist_id) {
    await admin.from('beta_waitlist').update({ status: 'accepted' }).eq('id', invite.waitlist_id);
  }
  await admin.from('product_events').insert({
    event_id: randomUUID(),
    user_id: userId,
    event_name: 'beta_signup_completed',
    properties: { cohort: invite.cohort },
  });

  return NextResponse.json({ ok: true });
}
