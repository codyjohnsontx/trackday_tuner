import { NextResponse } from 'next/server';
import { pdfResponse, renderBookPdf } from '@/lib/service-book-pdf';
import { consumeFullPdfAllowance, openShare } from '@/lib/service-book-share';
import { parsePdfRequest } from '@/lib/service-book/pdf-plan';

export const runtime = 'nodejs';
/** A full file reads up to 150 photos from storage inside this one invocation. */
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * A shared service book as a PDF (owner, Q5): the shared page's twin, so the
 * link is the only access control, through the same `openShare` lookup the page
 * makes, and the file prints `buildSharedBookView` and nothing else. A download
 * spends the link's rate limit without counting as a view, and a full file also
 * spends one of the link's few full files a day, since it reads every photo.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const opening = await openShare(token, { countView: false });
  if (opening.kind === 'not_found') return refuse('That link could not be found.', 404);
  if (opening.kind === 'rate_limited') return refuse('This link has been opened too often. Try again in an hour.', 429);
  if (opening.kind === 'failed') return refuse('The PDF could not be made. Try again.', 503);

  const pdfRequest = parsePdfRequest(new URL(request.url).searchParams);
  if (!pdfRequest) return refuse('Choose the summary or the full PDF.', 400);

  if (pdfRequest.variant === 'full') {
    const allowance = await consumeFullPdfAllowance(token);
    if (allowance === 'limited') return refuse('The full PDF has been downloaded too often from this link today. Try again tomorrow, or download the summary.', 429);
    if (allowance === 'failed') return refuse('The PDF could not be made. Try again.', 503);
  }

  const result = await renderBookPdf(opening.bookId, pdfRequest);
  if (result.kind === 'refused') return refuse(result.message, result.status);
  if (result.kind === 'failed') return refuse('The PDF could not be made. Try again.', 503);
  return pdfResponse(result.pdf, result.fileName);
}
