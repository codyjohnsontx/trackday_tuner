import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { refuseUnlessScheduler } from '@/lib/monitoring/cron-auth';
import { reportError } from '@/lib/monitoring/report-error';
import { STORAGE_REMOVE_BATCH_LIMIT } from '@/lib/storage-photo-removal';

/**
 * The object half of the service book attachment sweep (20261014000400).
 *
 * The daily `pg_cron` job deletes reservations nobody confirmed, but SQL cannot
 * delete from storage.objects, so the files those reservations uploaded - and
 * the files of a bike deleted while an upload was in flight, and anything sent
 * to a signed upload URL after its reservation was discarded, since a signed
 * upload token cannot be revoked - would stay in the bucket for good. This
 * removes them through the Storage API: every `service-book` object more than a
 * day old that no `ready` attachment names, as `service_attachment_orphan_objects`
 * lists them.
 *
 * Called every 15 minutes by `.github/workflows/monitoring.yml`, behind
 * `refuseUnlessScheduler`. One call removes at most one Storage batch, so a
 * backlog drains over successive runs; `/api/health`'s `attachment_sweep` fails
 * once an object has waited more than two days. A read or a removal that fails
 * answers `503`, which fails the workflow run.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const refused = refuseUnlessScheduler(request);
  if (refused) return refused;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('service_attachment_orphan_objects', {
    p_limit: STORAGE_REMOVE_BATCH_LIMIT,
  });
  if (error) {
    reportError('service-attachment-sweep', new Error(error.message), { reason: error.code });
    return answer(503, { status: 'failed', error: 'orphan_read_failed' });
  }

  const objects = (data ?? []).map((object) => object.name);
  if (objects.length === 0) return answer(200, { status: 'ok', removed: 0 });

  const removed = await admin.storage.from('service-book').remove(objects);
  if (removed.error) {
    reportError('service-attachment-sweep', new Error(removed.error.message), { objects: objects.length });
    return answer(503, { status: 'failed', error: 'remove_failed' });
  }
  return answer(200, { status: 'ok', removed: removed.data?.length ?? 0 });
}

function answer(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
