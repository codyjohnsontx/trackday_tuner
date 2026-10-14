import { NextResponse } from 'next/server';
import { getRealUser } from '@/lib/auth';
import { reportError } from '@/lib/monitoring/report-error';
import { isUuid } from '@/lib/rag/validation';
import { ATTACHMENT_READ_URL_SECONDS } from '@/lib/service-book/attachments';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * Opens one confirmed attachment by redirecting to a URL signed at the moment
 * it is asked for. The entry page
 * links here rather than to a signed URL, because a signed URL printed into a
 * page expires while the page stays open and the rider's tap then lands on a
 * storage error. Which row may be opened is the rider's own select under RLS;
 * only then does the service role sign the path that row names.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId } = await params;
  const user = await getRealUser();
  if (!user) return refuse('Not authenticated.', 401);
  if (!isUuid(attachmentId)) return refuse('That attachment could not be found.', 404);

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from('service_attachments')
    .select('object_path')
    .eq('id', attachmentId)
    .eq('status', 'ready')
    .maybeSingle();
  if (error) {
    reportError('service-attachment-read', new Error(error.message), { reason: error.code, userId: user.id, attachmentId });
    return refuse('The attachment could not be read. Try again.', 503);
  }
  if (!row) return refuse('That attachment could not be found.', 404);

  const signed = await createAdminClient()
    .storage.from('service-book')
    .createSignedUrl(row.object_path, ATTACHMENT_READ_URL_SECONDS);
  if (signed.error || !signed.data) {
    reportError('service-attachment-read', new Error(signed.error?.message ?? 'no signed URL'), {
      userId: user.id,
      attachmentId,
    });
    return refuse('The attachment could not be read. Try again.', 503);
  }
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: NO_STORE });
}
