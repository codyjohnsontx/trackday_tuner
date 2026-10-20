import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { betaAccessWindow, hashBetaInviteCode, normalizeBetaEmail } from '@/lib/beta';
import { isBetaInviteOnly } from '@/lib/env.server';
import { isHandoverTokenShape } from '@/lib/service-book/handover-view';
import { createAdminClient } from '@/lib/supabase/admin';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function cleanupAuthUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  reason: 'profile_setup' | 'invite_redemption',
) {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error('[beta/signup] auth-user cleanup failed', {
      userId,
      reason,
      error: error.message,
    });
  }
}

/**
 * A pending, unexpired handover is its recipient's invitation (owner,
 * 2026-10-19): the account holding the address a seller handed a bike to may
 * be created with the link's token and no code, so a first-time buyer is not
 * stranded at the link. Only that address, only while the handover is
 * pending; the account is an ordinary free one, with no beta cohort.
 */
async function signUpHandoverRecipient(email: string, password: string, token: string, now: Date) {
  const admin = createAdminClient();
  const { data: handover, error: handoverError } = await admin
    .from('service_book_transfers')
    .select('id')
    .eq('token_hash', createHash('sha256').update(token, 'utf8').digest('hex'))
    .eq('to_email_normalized', email)
    .eq('status', 'pending')
    .gt('expires_at', now.toISOString())
    .maybeSingle();

  if (handoverError) {
    console.error('[beta/signup] handover query failed', { email, error: handoverError.message });
    return NextResponse.json({ ok: false, error: 'Unable to finish account setup.' }, { status: 500 });
  }
  if (!handover) {
    return NextResponse.json(
      { ok: false, error: 'That handover link was not sent to this email, or is no longer pending. An invitation code still works.' },
      { status: 400 },
    );
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !created.user) {
    return NextResponse.json({ ok: false, error: 'Unable to create this account.' }, { status: 400 });
  }

  const { error: profileError } = await admin.from('profiles').upsert({ id: created.user.id, tier: 'free' });
  if (profileError) {
    await cleanupAuthUser(admin, created.user.id, 'profile_setup');
    return NextResponse.json({ ok: false, error: 'Unable to finish account setup.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

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
  const handoverToken = typeof body.handover_token === 'string' ? body.handover_token : '';
  if (!EMAIL.test(email) || email.length > 254) {
    return NextResponse.json({ ok: false, error: 'Enter a valid email.' }, { status: 400 });
  }
  if (password.length < 8 || password.length > 72) {
    return NextResponse.json({ ok: false, error: 'Password must be 8–72 characters.' }, { status: 400 });
  }
  if (!code && isHandoverTokenShape(handoverToken)) {
    return signUpHandoverRecipient(email, password, handoverToken, new Date());
  }
  if (!code || code.length > 200) {
    return NextResponse.json({ ok: false, error: 'Enter a valid invitation code.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const { data: invite, error: inviteError } = await admin
    .from('beta_invites')
    .select('*')
    .eq('code_hash', hashBetaInviteCode(code))
    .eq('email_normalized', email)
    .eq('status', 'active')
    .gt('expires_at', now.toISOString())
    .maybeSingle();

  if (inviteError) {
    console.error('[beta/signup] invite query failed', { email, error: inviteError.message });
    return NextResponse.json({ ok: false, error: 'Unable to finish account setup.' }, { status: 500 });
  }

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
    await cleanupAuthUser(admin, userId, 'profile_setup');
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
    await cleanupAuthUser(admin, userId, 'invite_redemption');
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
