import { NextResponse } from 'next/server';
import { getRealUser } from '@/lib/auth';
import { isDemoMode } from '@/lib/demo/mode';
import { reportError } from '@/lib/monitoring/report-error';
import { isUuid } from '@/lib/rag/validation';
import { pdfResponse, renderBookPdf } from '@/lib/service-book-pdf';
import { parsePdfRequest } from '@/lib/service-book/pdf-plan';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
/** A full file reads up to 150 photos from storage inside this one invocation. */
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * The owner's PDF of their bike's service book (owner, Q5). The rider's own
 * select of the book is the access control - RLS admits only a book on one of
 * their bikes - and the file is then made exactly as a share link's is, so what
 * the owner hands a buyer is what a buyer would download themselves.
 */
export async function GET(request: Request, { params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  // The demo book is sample data in code, not rows, so there is nothing to print.
  if (await isDemoMode()) return refuse('The demo has no service book to export.', 404);

  const user = await getRealUser();
  if (!user) return refuse('Not authenticated.', 401);
  if (!isUuid(vehicleId)) return refuse('This bike has no service book yet.', 404);

  const pdfRequest = parsePdfRequest(new URL(request.url).searchParams);
  if (!pdfRequest) return refuse('Choose the summary or the full PDF.', 400);

  const supabase = await createClient();
  const { data: book, error } = await supabase.from('service_books').select('id').eq('vehicle_id', vehicleId).maybeSingle();
  if (error) {
    reportError('service-book-pdf', new Error(error.message), { reason: error.code, table: 'service_books', userId: user.id, vehicleId });
    return refuse('The PDF could not be made. Try again.', 503);
  }
  if (!book) return refuse('This bike has no service book yet.', 404);

  const result = await renderBookPdf(book.id, pdfRequest);
  if (result.kind === 'refused') return refuse(result.message, result.status);
  if (result.kind === 'failed') return refuse('The PDF could not be made. Try again.', 503);
  return pdfResponse(result.pdf, result.fileName);
}
