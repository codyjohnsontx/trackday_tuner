'use server';

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { reportError } from '@/lib/monitoring/report-error';
import { isUuid } from '@/lib/rag/validation';
import { createShareToken, hashShareToken } from '@/lib/service-book-share';
import { isKnownTimeZone } from '@/lib/service-book/provenance';
import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/types/supabase';
import type { ActionResult } from '@/types';

/**
 * The owner's side of a shared service book (owner, Q5): making a link,
 * revoking one, and recording the owner's time zone that a shared book is
 * labelled in. Every write runs as the rider, so RLS on `service_book_shares`
 * (20261016000500) decides which book a link may name, and the database dates a
 * revoke and keeps it. The token is made and hashed here; only its hash is
 * stored, so the link is shown once.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type Failure = { message: string; code?: string; details?: string | null; hint?: string | null };

const NOT_AUTHENTICATED = 'Not authenticated.';
const BOOK_NOT_FOUND = 'This bike has no service book yet.';
const SHARE_NOT_FOUND = 'That share link could not be found.';
const READ_FAILED = 'The share links could not be read. Try again.';
const WRITE_FAILED = 'The share link could not be saved. Try again.';

/** The shape the database's check holds `owner_time_zone` to. */
const TIME_ZONE_SHAPE = /^[A-Za-z0-9_+/-]{1,64}$/;

function report(event: string, error: Failure, context: Record<string, unknown>) {
  reportError(event, new Error(error.message), { reason: error.code, details: error.details, hint: error.hint, ...context });
}

/** A zone worth storing: the shape the column takes, and one the server's clock reads. */
function storableTimeZone(timeZone: unknown): string | null {
  return typeof timeZone === 'string' && TIME_ZONE_SHAPE.test(timeZone) && isKnownTimeZone(timeZone) ? timeZone : null;
}

async function ownBook(
  supabase: SupabaseServerClient,
  vehicleId: string,
): Promise<{ ok: true; book: Pick<Tables<'service_books'>, 'id' | 'owner_time_zone'> | null } | { ok: false; error: Failure }> {
  if (!isUuid(vehicleId)) return { ok: true, book: null };
  // RLS admits only a book on one of the rider's own bikes.
  const { data, error } = await supabase.from('service_books').select('id, owner_time_zone').eq('vehicle_id', vehicleId).maybeSingle();
  if (error) return { ok: false, error };
  return { ok: true, book: data ?? null };
}

async function writeOwnerTimeZone(
  supabase: SupabaseServerClient,
  book: Pick<Tables<'service_books'>, 'id' | 'owner_time_zone'>,
  timeZone: string,
): Promise<Failure | null> {
  if (book.owner_time_zone === timeZone) return null;
  const { error } = await supabase.from('service_books').update({ owner_time_zone: timeZone }).eq('id', book.id);
  return error;
}

export type ServiceBookShare = Pick<Tables<'service_book_shares'>, 'id' | 'created_at' | 'view_count' | 'last_viewed_at'>;

/** The book's links that still open it, newest first. */
export async function getServiceBookShares(vehicleId: string): Promise<ActionResult<ServiceBookShare[]>> {
  if (await isDemoMode()) return { ok: true, data: [] };

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const supabase = await createClient();
  const bookRead = await ownBook(supabase, vehicleId);
  if (!bookRead.ok) {
    report('service-book-share-list', bookRead.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: READ_FAILED };
  }
  if (!bookRead.book) return { ok: false, error: BOOK_NOT_FOUND };

  const { data, error } = await supabase
    .from('service_book_shares')
    .select('id, created_at, view_count, last_viewed_at')
    .eq('book_id', bookRead.book.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    report('service-book-share-list', error, { table: 'service_book_shares', userId: user.id, vehicleId });
    return { ok: false, error: READ_FAILED };
  }
  return { ok: true, data: data ?? [] };
}

/**
 * Makes a link to the book and returns its token, which is stored nowhere and
 * so is returned only this once. `timeZone` is the owner's browser zone: it is
 * recorded first, so the book a buyer opens is already labelled in it.
 */
export async function createServiceBookShare(
  vehicleId: string,
  timeZone: string,
): Promise<ActionResult<{ token: string; share: ServiceBookShare }>> {
  const demoError = await assertNotDemoMode<{ token: string; share: ServiceBookShare }>();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const supabase = await createClient();
  const bookRead = await ownBook(supabase, vehicleId);
  if (!bookRead.ok) {
    report('service-book-share-create', bookRead.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (!bookRead.book) return { ok: false, error: BOOK_NOT_FOUND };

  const zone = storableTimeZone(timeZone);
  if (zone) {
    const zoneError = await writeOwnerTimeZone(supabase, bookRead.book, zone);
    if (zoneError) {
      report('service-book-share-create', zoneError, { table: 'service_books', userId: user.id, vehicleId });
      return { ok: false, error: WRITE_FAILED };
    }
  }

  const token = createShareToken();
  const { data, error } = await supabase
    .from('service_book_shares')
    .insert({ book_id: bookRead.book.id, token_hash: hashShareToken(token) })
    .select('id, created_at, view_count, last_viewed_at')
    .single();
  if (error || !data) {
    report('service-book-share-create', error ?? { message: 'no row returned' }, { table: 'service_book_shares', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }

  revalidatePath(`/garage/${vehicleId}/book`);
  return { ok: true, data: { token, share: data } };
}

/** Revokes one of the book's links for good; the database dates it and never undoes it. */
export async function revokeServiceBookShare(vehicleId: string, shareId: string): Promise<ActionResult<void>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (!isUuid(shareId)) return { ok: false, error: SHARE_NOT_FOUND };

  const supabase = await createClient();
  const bookRead = await ownBook(supabase, vehicleId);
  if (!bookRead.ok) {
    report('service-book-share-revoke', bookRead.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (!bookRead.book) return { ok: false, error: BOOK_NOT_FOUND };

  const { data, error } = await supabase
    .from('service_book_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId)
    .eq('book_id', bookRead.book.id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();
  if (error) {
    report('service-book-share-revoke', error, { table: 'service_book_shares', userId: user.id, vehicleId, shareId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (!data) return { ok: false, error: SHARE_NOT_FOUND };

  revalidatePath(`/garage/${vehicleId}/book`);
  return { ok: true, data: undefined };
}

/**
 * Records the owner's zone when they open their book, so a shared copy is
 * labelled where the owner is (owner, Q4). A zone this server cannot read is
 * not stored, and an unchanged one writes nothing.
 */
export async function recordServiceBookOwnerTimeZone(vehicleId: string, timeZone: string): Promise<ActionResult<void>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  const zone = storableTimeZone(timeZone);
  if (!zone) return { ok: false, error: 'That time zone is not one this server knows.' };

  const supabase = await createClient();
  const bookRead = await ownBook(supabase, vehicleId);
  if (!bookRead.ok) {
    report('service-book-time-zone', bookRead.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (!bookRead.book) return { ok: false, error: BOOK_NOT_FOUND };

  const error = await writeOwnerTimeZone(supabase, bookRead.book, zone);
  if (error) {
    report('service-book-time-zone', error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }
  return { ok: true, data: undefined };
}
