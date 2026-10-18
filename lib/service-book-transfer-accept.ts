import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/supabase';

/**
 * The buyer's side of a handover (owner, PQ2), as the three steps the schema
 * gives it (20261017000600): `prepare_service_book_transfer_accept` mints the
 * new ids and names every storage object to copy, the server copies them with
 * the service role, and `accept_service_book_transfer` is the one transaction,
 * which refuses with TT409 unless every object is there and every session and
 * receipt of the bike is in its maps. Each step is idempotent, so a slow or
 * failed copy, or a session the seller synced between the two calls, is met by
 * running the three again - at most `HANDOVER_ACCEPT_ATTEMPTS` times here, and
 * by the buyer pressing Accept again after that.
 *
 * The rider's own client calls the two functions, so the database decides who
 * may take the bike (the account holding the email, not the seller, under the
 * free vehicle cap); the service role touches storage only, because SQL cannot
 * write an object and no rider policy opens the seller's folders.
 *
 * Takes its clients rather than making them, so the orchestration is proven
 * without a database (`service-book-transfer-accept.test.ts`); the server
 * action supplies the real ones.
 */

export interface PreparedAttachmentCopy {
  attachment_id: string;
  from_object: string;
  to_object: string;
  from_thumb: string | null;
  to_thumb: string | null;
}

export interface PreparedPhotoCopy {
  session_id: string;
  from_path: string;
  to_path: string;
}

export interface PreparedHandover {
  accepted: boolean;
  vehicle_id: string;
  book_id: string;
  attachments: PreparedAttachmentCopy[];
  session_photos: PreparedPhotoCopy[];
  vehicle_photo: { from_path: string; to_path: string } | null;
}

export interface AcceptedHandover {
  vehicleId: string;
  bookId: string;
  entries: number;
  sessions: number;
  attachments: number;
}

export type HandoverStage = 'prepare' | 'copy' | 'accept';

export type HandoverOutcome =
  | { ok: true; data: AcceptedHandover; attempts: number; objectsCopied: number }
  | { ok: false; stage: HandoverStage; code: string | undefined; message: string; attempts: number };

/** One storage copy: the seller's object to the buyer's path, in one bucket. */
export interface ObjectCopy {
  bucket: 'service-book' | 'session-photos' | 'vehicle-photos';
  from: string;
  to: string;
}

type Failure = { message: string; code?: string };

/** The storage API as this needs it: `copy`, `remove` and `getPublicUrl` on a bucket. */
export interface HandoverStorage {
  from(bucket: string): {
    copy(from: string, to: string): PromiseLike<{ error: { message: string; statusCode?: string | number } | null }>;
    remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    getPublicUrl(path: string): { data: { publicUrl: string } };
  };
}

export type HandoverRpcClient = Pick<SupabaseClient<Database>, 'rpc'>;

export interface TakeOverParams {
  rider: HandoverRpcClient;
  storage: HandoverStorage;
  token: string;
  /** What a swallowed failure is reported through (`reportError`). */
  report: (event: string, error: Error, context: Record<string, unknown>) => void;
}

/** How many storage copies run at once. A full free book is 50 objects plus photos. */
export const HANDOVER_COPY_BATCH = 10;

/** How many times prepare, copy and accept are run before the buyer is asked to press Accept again. */
export const HANDOVER_ACCEPT_ATTEMPTS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** What prepare answered, read without trusting its shape; null when it is not a prepared handover. */
export function readPreparedHandover(value: unknown): PreparedHandover | null {
  if (!isRecord(value)) return null;
  const vehicleId = str(value.vehicle_id);
  const bookId = str(value.book_id);
  if (!vehicleId || !bookId || typeof value.accepted !== 'boolean') return null;

  const attachments: PreparedAttachmentCopy[] = [];
  for (const row of Array.isArray(value.attachments) ? value.attachments : []) {
    if (!isRecord(row)) return null;
    const attachmentId = str(row.attachment_id);
    const fromObject = str(row.from_object);
    const toObject = str(row.to_object);
    if (!attachmentId || !fromObject || !toObject) return null;
    const fromThumb = str(row.from_thumb);
    const toThumb = str(row.to_thumb);
    attachments.push({ attachment_id: attachmentId, from_object: fromObject, to_object: toObject, from_thumb: fromThumb, to_thumb: fromThumb ? toThumb : null });
  }

  const sessionPhotos: PreparedPhotoCopy[] = [];
  for (const row of Array.isArray(value.session_photos) ? value.session_photos : []) {
    if (!isRecord(row)) return null;
    const sessionId = str(row.session_id);
    const fromPath = str(row.from_path);
    const toPath = str(row.to_path);
    if (!sessionId || !fromPath || !toPath) return null;
    sessionPhotos.push({ session_id: sessionId, from_path: fromPath, to_path: toPath });
  }

  let vehiclePhoto: PreparedHandover['vehicle_photo'] = null;
  if (value.vehicle_photo !== null && value.vehicle_photo !== undefined) {
    if (!isRecord(value.vehicle_photo)) return null;
    const fromPath = str(value.vehicle_photo.from_path);
    const toPath = str(value.vehicle_photo.to_path);
    if (!fromPath || !toPath) return null;
    vehiclePhoto = { from_path: fromPath, to_path: toPath };
  }

  return { accepted: value.accepted, vehicle_id: vehicleId, book_id: bookId, attachments, session_photos: sessionPhotos, vehicle_photo: vehiclePhoto };
}

/** What accept answered, read the same way. */
export function readAcceptedHandover(value: unknown): AcceptedHandover | null {
  if (!isRecord(value)) return null;
  const vehicleId = str(value.vehicle_id);
  const bookId = str(value.book_id);
  if (!vehicleId || !bookId) return null;
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  return { vehicleId, bookId, entries: count(value.entries), sessions: count(value.sessions), attachments: count(value.attachments) };
}

/** Every storage copy a prepared handover asks for, file and thumbnail each. */
export function objectCopiesOf(prepared: PreparedHandover): ObjectCopy[] {
  const copies: ObjectCopy[] = [];
  for (const attachment of prepared.attachments) {
    copies.push({ bucket: 'service-book', from: attachment.from_object, to: attachment.to_object });
    if (attachment.from_thumb && attachment.to_thumb) {
      copies.push({ bucket: 'service-book', from: attachment.from_thumb, to: attachment.to_thumb });
    }
  }
  for (const photo of prepared.session_photos) {
    copies.push({ bucket: 'session-photos', from: photo.from_path, to: photo.to_path });
  }
  if (prepared.vehicle_photo) {
    copies.push({ bucket: 'vehicle-photos', from: prepared.vehicle_photo.from_path, to: prepared.vehicle_photo.to_path });
  }
  return copies;
}

/**
 * A copy that found its destination already there counts as done: a retry
 * after a slow or half-finished attempt skips what landed. The storage API
 * answers 409 with "The resource already exists".
 */
function alreadyThere(error: { message: string; statusCode?: string | number }): boolean {
  return String(error.statusCode ?? '') === '409' || /already exists/i.test(error.message);
}

/**
 * Copies every object, `HANDOVER_COPY_BATCH` at a time, and returns the copies
 * that failed. One failed batch does not stop the next: accept is going to ask
 * for every object anyway, so the more that landed, the less a retry has to do.
 */
export async function copyHandoverObjects(storage: HandoverStorage, copies: readonly ObjectCopy[]): Promise<{ copy: ObjectCopy; message: string }[]> {
  const failed: { copy: ObjectCopy; message: string }[] = [];
  for (let start = 0; start < copies.length; start += HANDOVER_COPY_BATCH) {
    const batch = copies.slice(start, start + HANDOVER_COPY_BATCH);
    const results = await Promise.all(
      batch.map(async (copy) => {
        try {
          const { error } = await storage.from(copy.bucket).copy(copy.from, copy.to);
          if (error && !alreadyThere(error)) return { copy, message: error.message };
          return null;
        } catch (thrown) {
          return { copy, message: thrown instanceof Error ? thrown.message : String(thrown) };
        }
      }),
    );
    for (const result of results) if (result) failed.push(result);
  }
  return failed;
}

/** The public URLs accept is told to store, for the copies into the two public buckets. */
export function photoUrlsOf(storage: HandoverStorage, prepared: PreparedHandover): Json {
  const sessions: Record<string, string> = {};
  for (const photo of prepared.session_photos) {
    sessions[photo.session_id] = storage.from('session-photos').getPublicUrl(photo.to_path).data.publicUrl;
  }
  return {
    vehicle: prepared.vehicle_photo ? storage.from('vehicle-photos').getPublicUrl(prepared.vehicle_photo.to_path).data.publicUrl : null,
    sessions,
  };
}

/**
 * Takes the copies in the two PUBLIC buckets back after a handover that will
 * not complete: nothing names them and, unlike the private `service-book`
 * bucket, no sweep removes them. Best effort - a failure here is reported and
 * costs nothing but an orphaned photo.
 */
async function removePublicCopies(storage: HandoverStorage, copies: readonly ObjectCopy[], report: TakeOverParams['report'], context: Record<string, unknown>) {
  for (const bucket of ['session-photos', 'vehicle-photos'] as const) {
    const paths = copies.filter((copy) => copy.bucket === bucket).map((copy) => copy.to);
    if (paths.length === 0) continue;
    try {
      const { error } = await storage.from(bucket).remove(paths);
      if (error) report('service-book-handover-cleanup', new Error(error.message), { bucket, paths, ...context });
    } catch (thrown) {
      report('service-book-handover-cleanup', thrown instanceof Error ? thrown : new Error(String(thrown)), { bucket, paths, ...context });
    }
  }
}

/**
 * Prepare, copy, accept - and again, up to `HANDOVER_ACCEPT_ATTEMPTS` times,
 * when accept answers TT409. Any other refusal is final and returned with its
 * code; the server action words it for the buyer.
 */
export async function takeOverServiceBook({ rider, storage, token, report }: TakeOverParams): Promise<HandoverOutcome> {
  let attempts = 0;
  let objectsCopied = 0;
  let lastCopies: ObjectCopy[] = [];
  const context = { tokenLength: token.length };

  const giveUp = async (outcome: Extract<HandoverOutcome, { ok: false }>): Promise<HandoverOutcome> => {
    if (lastCopies.length > 0) await removePublicCopies(storage, lastCopies, report, context);
    return outcome;
  };

  while (attempts < HANDOVER_ACCEPT_ATTEMPTS) {
    attempts += 1;

    const prepared = await rider.rpc('prepare_service_book_transfer_accept', { p_token: token });
    if (prepared.error) {
      return giveUp({ ok: false, stage: 'prepare', code: prepared.error.code, message: prepared.error.message, attempts });
    }
    const plan = readPreparedHandover(prepared.data);
    if (!plan) {
      report('service-book-handover-prepare', new Error('prepare answered an unreadable plan'), context);
      return giveUp({ ok: false, stage: 'prepare', code: undefined, message: 'unreadable plan', attempts });
    }

    const copies = plan.accepted ? [] : objectCopiesOf(plan);
    lastCopies = copies;
    const failed = await copyHandoverObjects(storage, copies);
    objectsCopied += copies.length - failed.length;
    if (failed.length > 0) {
      for (const failure of failed) {
        report('service-book-handover-copy', new Error(failure.message), { bucket: failure.copy.bucket, from: failure.copy.from, to: failure.copy.to, ...context });
      }
      return giveUp({ ok: false, stage: 'copy', code: undefined, message: failed[0].message, attempts });
    }

    const accepted = await rider.rpc('accept_service_book_transfer', { p_token: token, p_photo_urls: photoUrlsOf(storage, plan) });
    if (accepted.error) {
      const failure: Failure = accepted.error;
      // The bike changed between prepare and accept, or a copy has not settled:
      // prepare again extends the maps, and the copies that landed are skipped.
      if (failure.code === 'TT409' && attempts < HANDOVER_ACCEPT_ATTEMPTS) continue;
      return giveUp({ ok: false, stage: 'accept', code: failure.code, message: failure.message, attempts });
    }
    const result = readAcceptedHandover(accepted.data);
    if (!result) {
      report('service-book-handover-accept', new Error('accept answered an unreadable result'), context);
      return { ok: false, stage: 'accept', code: undefined, message: 'unreadable result', attempts };
    }
    return { ok: true, data: result, attempts, objectsCopied };
  }

  // Unreachable: the loop returns on every path. Kept so the function has a
  // value on every branch the compiler can see.
  return { ok: false, stage: 'accept', code: 'TT409', message: 'the handover did not settle', attempts };
}
