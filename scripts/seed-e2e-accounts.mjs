// Creates the accounts the e2e suite signs in as, on a local Supabase stack.
//
// Most specs make their own throwaway rider. The rest drive one shared account
// named by E2E_EMAIL / E2E_PASSWORD, which TESTING.md requires to be on the Pro
// tier and which needs a standing vehicle and session. The 402 check in
// ai-tuning-advice.spec.ts drives a free-tier account with a vehicle and a
// session (E2E_FREE_*). CI builds a stack from nothing on every run, so nothing
// holds those accounts until this makes them.
//
// Prints the variables as KEY=value lines on stdout, the format $GITHUB_ENV
// reads. It refuses any NEXT_PUBLIC_SUPABASE_URL that is not loopback, as
// playwright.db.config.ts does, because it creates Auth users with the service
// role.

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('[seed-e2e-accounts] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  console.error(`[seed-e2e-accounts] refusing to create accounts on ${host}: only a local stack is allowed.`);
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EMPTY_TIRES = {
  front: { brand: '', compound: '', pressure: '' },
  rear: { brand: '', compound: '', pressure: '' },
  condition: null,
};
const EMPTY_SUSPENSION = {
  front: { preload: '', compression: '', rebound: '', direction: 'out' },
  rear: { preload: '', compression: '', rebound: '', direction: 'out' },
};

function fail(what, error) {
  console.error(`[seed-e2e-accounts] ${what}: ${error.message}`);
  process.exit(1);
}

async function createRider(label, tier) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) fail(`creating ${label}`, error);
  const id = data.user.id;

  // The profiles row comes from the auth.users trigger (20260816001200).
  const { data: updated, error: tierError } = await admin
    .from('profiles')
    .update({ tier })
    .eq('id', id)
    .select('id');
  if (tierError) fail(`setting ${label} to ${tier}`, tierError);
  if (updated.length !== 1) fail(`setting ${label} to ${tier}`, new Error('no profiles row'));

  const { data: vehicle, error: vehicleError } = await admin
    .from('vehicles')
    .insert({ user_id: id, nickname: `${label} bike`, type: 'motorcycle' })
    .select('id')
    .single();
  if (vehicleError) fail(`creating ${label}'s vehicle`, vehicleError);

  return { id, email, password, vehicleId: vehicle.id };
}

// Each rider also gets one session: the Race Engineer smoke in
// auth-and-sag.spec.ts opens the shared account's first session, and the 402
// check posts the free rider's.
async function createSession(rider) {
  const { data, error } = await admin
    .from('sessions')
    .insert({
      user_id: rider.id,
      vehicle_id: rider.vehicleId,
      track_name: 'Seeded circuit',
      date: '2026-06-13',
      conditions: 'sunny',
      tires: EMPTY_TIRES,
      suspension: EMPTY_SUSPENSION,
    })
    .select('id')
    .single();
  if (error) fail(`creating ${rider.email}'s session`, error);
  return data.id;
}

const pro = await createRider('e2e-pro', 'pro');
await createSession(pro);
const free = await createRider('e2e-free', 'free');
const freeSessionId = await createSession(free);

console.log(`E2E_EMAIL=${pro.email}`);
console.log(`E2E_PASSWORD=${pro.password}`);
console.log(`E2E_FREE_EMAIL=${free.email}`);
console.log(`E2E_FREE_PASSWORD=${free.password}`);
console.log(`E2E_FREE_VEHICLE_ID=${free.vehicleId}`);
console.log(`E2E_FREE_SESSION_ID=${freeSessionId}`);
