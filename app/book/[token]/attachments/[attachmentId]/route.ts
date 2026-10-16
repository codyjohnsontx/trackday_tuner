import { NextResponse } from 'next/server';
import { reportError } from '@/lib/monitoring/report-error';
import { isUuid } from '@/lib/rag/validation';
import { ATTACHMENT_READ_URL_SECONDS } from '@/lib/service-book/attachments';
import { openShare, sharedAttachmentPath } from '@/lib/service-book-share';
import { createAdminClient } from '@/lib/supabase/admin';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * Opens one attachment of a shared service book by redirecting to a URL signed
 * as it is asked for - the shared page's twin of
 * `/api/service-book/attachments/[attachmentId]`. The link is the access
 * control: only an unrevoked link opens anything, only an attachment of a live
 * entry in the book that link names is signed, and every open spends the link's
 * rate limit without counting as a view. The bucket stays private throughout.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; attachmentId: string }> }) {
  const { token, attachmentId } = await params;
  const opening = await openShare(token, { countView: false });
  if (opening.kind === 'not_found') return refuse('That link could not be found.', 404);
  if (opening.kind === 'rate_limited') return refuse('This link has been opened too often. Try again in an hour.', 429);
  if (opening.kind === 'failed') return refuse('The attachment could not be read. Try again.', 503);
  if (!isUuid(attachmentId)) return refuse('That attachment could not be found.', 404);

  const found = await sharedAttachmentPath(opening.bookId, attachmentId);
  if ('failed' in found) return refuse('The attachment could not be read. Try again.', 503);
  if (!found.path) return refuse('That attachment could not be found.', 404);

  const signed = await createAdminClient().storage.from('service-book').createSignedUrl(found.path, ATTACHMENT_READ_URL_SECONDS);
  if (signed.error || !signed.data) {
    reportError('service-book-share-read', new Error(signed.error?.message ?? 'no signed URL'), { attachmentId });
    return refuse('The attachment could not be read. Try again.', 503);
  }
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: NO_STORE });
}
