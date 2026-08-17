'use server';

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';
import type { TableInsert } from '@/types/supabase';
import type { ActionResult, CreateSagEntryInput, SagEntry } from '@/types';

export async function getSagEntries(): Promise<SagEntry[]> {
  if (await isDemoMode()) {
    return [];
  }

  const user = await getRealUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('sag_entries')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return (data ?? []) as SagEntry[];
}

export async function createSagEntry(
  input: CreateSagEntryInput
): Promise<ActionResult<SagEntry>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const hasAnyMeasurement = [
    input.front_l0,
    input.front_l1,
    input.front_l2,
    input.rear_l0,
    input.rear_l1,
    input.rear_l2,
  ].some((value) => value !== null && value !== undefined);

  if (!hasAnyMeasurement) {
    return { ok: false, error: 'Enter at least one suspension measurement.' };
  }

  const supabase = await createClient();
  const payload: TableInsert<'sag_entries'> = {
    user_id: user.id,
    label: input.label?.trim() || null,
    notes: input.notes?.trim() || null,
    front_l0: input.front_l0 ?? null,
    front_l1: input.front_l1 ?? null,
    front_l2: input.front_l2 ?? null,
    rear_l0: input.rear_l0 ?? null,
    rear_l1: input.rear_l1 ?? null,
    rear_l2: input.rear_l2 ?? null,
    front_travel_mm: input.front_travel_mm ?? null,
    rear_travel_mm: input.rear_travel_mm ?? null,
  };
  const { data, error } = await supabase
    .from('sag_entries')
    .insert(payload)
    .select('*')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/sag');

  return { ok: true, data: data as SagEntry };
}

/**
 * Remove a saved sag entry.
 *
 * `sag_entries` shipped with a "delete own" RLS policy and a delete grant to
 * `authenticated` from the day the table was created, and nothing ever called
 * them - so a mistyped measurement stayed in the history forever, beside the
 * corrected one, with no way to tell which was which.
 */
export async function deleteSagEntry(id: string): Promise<ActionResult> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sag_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id');

  if (error) return { ok: false, error: error.message };
  // RLS turns someone else's row into zero rows deleted rather than an error, so
  // silence here would report success for a delete that did not happen.
  if (!data || data.length === 0) return { ok: false, error: 'Sag entry not found.' };

  revalidatePath('/sag');

  return { ok: true, data: undefined };
}
