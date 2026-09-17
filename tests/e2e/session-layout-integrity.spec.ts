import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import type { Database, TableInsert } from '@/types/supabase';

// `createSession` checks a submitted layout against the circuit it was
// submitted with, but `authenticated` writes `sessions` directly and the
// foreign key only proves a layout exists. So the pairing is enforced by the
// `sessions_check_layout` trigger 20260916001600 installs, and this is the
// request that proves it: a rider, holding the public key and their own
// session, writes a Cresson layout onto a VIR session through PostgREST.
//
// Needs no browser and no dev server - the rider is made through the admin
// API - only a stack with the seeded circuits.

const RESTRICT_VIOLATION = '23514';

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

function anonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
}

async function seeded(admin: SupabaseClient<Database>, slug: string) {
  const { data, error } = await admin
    .from('tracks')
    .select('id, name, track_layouts(id, name)')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`reading seeded track ${slug} failed: ${error.message}`);
  return data as { id: string; name: string; track_layouts: { id: string; name: string }[] } | null;
}

test.describe('a session and the layout it names', () => {
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is required to write as the rider.',
  );

  let admin: SupabaseClient<Database>;
  let rider: SupabaseClient<Database>;
  let userId: string | null = null;
  let vehicleId: string;
  let cresson: NonNullable<Awaited<ReturnType<typeof seeded>>>;
  let vir: NonNullable<Awaited<ReturnType<typeof seeded>>>;

  test.beforeAll(async ({}, workerInfo) => {
    admin = createTestAdminClient();
    const cressonRow = await seeded(admin, 'motorsport-ranch');
    const virRow = await seeded(admin, 'virginia-international-raceway');
    test.skip(
      !cressonRow || !virRow,
      'the stack has no seeded tracks - apply 20260916001600_seed_north_america_tracks.sql',
    );
    cresson = cressonRow!;
    vir = virRow!;
    if (cresson.track_layouts.length === 0) throw new Error('MotorSport Ranch was seeded with no layouts');

    const email = `layout-integrity-${workerInfo.project.name}-${randomUUID()}@example.com`;
    const password = `pw-${randomUUID()}`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error(`creating the throwaway rider failed: ${createError?.message ?? 'no user'}`);
    }
    userId = created.user.id;

    rider = createClient<Database>(supabaseUrl(), anonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await rider.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`signing in as the rider failed: ${signInError.message}`);

    const { data: vehicle, error: vehicleError } = await rider
      .from('vehicles')
      .insert({ user_id: userId, nickname: 'Layout check', type: 'motorcycle' })
      .select('id')
      .single();
    if (vehicleError || !vehicle) throw new Error(`creating the vehicle failed: ${vehicleError?.message}`);
    vehicleId = vehicle.id;
  });

  test.afterAll(async () => {
    // Deleting the user cascades to the rider's vehicles and sessions.
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  function sessionRow(
    trackId: string,
    trackName: string,
    layout: { id: string } | null,
    layoutName: string | null,
  ): TableInsert<'sessions'> {
    return {
      user_id: userId!,
      vehicle_id: vehicleId,
      date: '2019-07-13',
      conditions: 'sunny',
      tires: {
        front: { brand: '', compound: '', pressure: '' },
        rear: { brand: '', compound: '', pressure: '' },
        condition: null,
      },
      suspension: {
        front: { preload: '', compression: '', rebound: '', direction: 'out' },
        rear: { preload: '', compression: '', rebound: '', direction: 'out' },
      },
      track_id: trackId,
      track_name: trackName,
      layout_id: layout?.id ?? null,
      layout_name: layoutName,
    };
  }

  test('refuses a layout of a different circuit, on insert and on update', async () => {
    const cressonLayout = cresson.track_layouts[0];

    const inserted = await rider
      .from('sessions')
      .insert(sessionRow(vir.id, vir.name, cressonLayout, cressonLayout.name))
      .select('id');
    expect({ code: inserted.error?.code ?? null, rows: inserted.data }).toEqual({
      code: RESTRICT_VIOLATION,
      rows: null,
    });

    const { data: onCresson, error } = await rider
      .from('sessions')
      .insert(sessionRow(cresson.id, cresson.name, cressonLayout, cressonLayout.name))
      .select('id')
      .single();
    expect(error).toBeNull();

    const moved = await rider.from('sessions').update({ track_id: vir.id }).eq('id', onCresson!.id).select('id');
    expect(moved.error?.code ?? null).toBe(RESTRICT_VIOLATION);

    const { data: stored } = await admin.from('sessions').select('track_id').eq('id', onCresson!.id).single();
    expect(stored?.track_id).toBe(cresson.id);
  });

  test("stores the layout row's own name, whatever was written", async () => {
    const layout = cresson.track_layouts[0];

    const { data: created, error } = await rider
      .from('sessions')
      .insert(sessionRow(cresson.id, cresson.name, layout, 'Not the real name'))
      .select('id, layout_name')
      .single();
    expect(error).toBeNull();
    expect(created?.layout_name).toBe(layout.name);

    const renamed = await rider
      .from('sessions')
      .update({ layout_name: 'Also not it' })
      .eq('id', created!.id)
      .select('layout_name')
      .single();
    expect(renamed.data?.layout_name).toBe(layout.name);
  });
});
