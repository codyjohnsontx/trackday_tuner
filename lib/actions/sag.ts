'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult, CreateSagEntryInput, SagEntry } from '@/types';

export async function getSagEntries(): Promise<SagEntry[]> {
  const user = await getAuthenticatedUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('sag_entries')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return (data as SagEntry[]) ?? [];
}

export async function createSagEntry(
  input: CreateSagEntryInput
): Promise<ActionResult<SagEntry>> {
  const user = await getAuthenticatedUser();
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
  const { data, error } = await supabase
    .from('sag_entries')
    .insert({
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
    })
    .select('*')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/sag');

  return { ok: true, data: data as SagEntry };
}
