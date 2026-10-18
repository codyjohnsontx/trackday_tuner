import 'server-only';
import { createHash } from 'node:crypto';
import { reportError } from '@/lib/monitoring/report-error';
import { readHandoverDescription, type HandoverDescription } from '@/lib/service-book/handover-view';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The handover link page's one read (owner, PQ2): what
 * `describe_service_book_transfer` (20261017000600) says a link is to the
 * viewer. The function is granted to the service role alone, so the page asks
 * with the admin client and passes the signed-in viewer's id and email; the
 * function answers the bike and the counts only to the recipient of a pending
 * link, and nothing to anyone else - this module adds nothing to that.
 *
 * The token travels raw: the database hashes it, so the stored hash is not a
 * key. Opening a link is rate limited on the token's hash, as a share link is,
 * so one link cannot be hammered; a token is 256 random bits, so guessing one
 * is not what the limit is for.
 */

export const HANDOVER_OPEN_LIMIT = 60;
export const HANDOVER_OPEN_WINDOW_SECONDS = 60 * 60;

export type HandoverOpening =
  | { kind: 'described'; description: HandoverDescription }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

export interface HandoverViewer {
  id: string;
  email: string | null;
}

export async function describeHandover(token: string, viewer: HandoverViewer | null): Promise<HandoverOpening> {
  const admin = createAdminClient();
  const keyHash = createHash('sha256').update(token, 'utf8').digest('hex');

  const limited = await admin.rpc('consume_beta_rate_limit', {
    p_key_hash: `service-book-transfer:${keyHash}`,
    p_limit: HANDOVER_OPEN_LIMIT,
    p_window_seconds: HANDOVER_OPEN_WINDOW_SECONDS,
  });
  if (limited.error) {
    reportError('service-book-handover-open', new Error(limited.error.message), { reason: limited.error.code, step: 'rate_limit' });
    return { kind: 'failed' };
  }
  if (limited.data) return { kind: 'rate_limited' };

  const { data, error } = await admin.rpc('describe_service_book_transfer', {
    p_token: token,
    p_viewer_id: viewer?.id ?? null,
    p_viewer_email: viewer?.email ?? null,
  });
  if (error) {
    reportError('service-book-handover-open', new Error(error.message), { reason: error.code, step: 'describe' });
    return { kind: 'failed' };
  }
  return { kind: 'described', description: readHandoverDescription(data) };
}
