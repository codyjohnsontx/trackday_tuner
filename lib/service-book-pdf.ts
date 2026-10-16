import 'server-only';
import { createElement, type ReactElement } from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { ServiceBookPdfDocument, type PdfImagePage } from '@/components/service-book/service-book-pdf-document';
import { reportError } from '@/lib/monitoring/report-error';
import { loadSharedBook } from '@/lib/service-book-share';
import { isKnownTimeZone } from '@/lib/service-book/provenance';
import { pdfFileName, planBookPdf, tooManyImagesMessage, type PdfRequest } from '@/lib/service-book/pdf-plan';
import { buildSharedBookView } from '@/lib/service-book/shared-view';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Renders a bike's service book as a PDF for one book the caller has already
 * been allowed to read - the owner through RLS, a visitor through a share link
 * `open_service_book_share` answered. Both read the book through
 * `loadSharedBook` and print `buildSharedBookView`, so the owner's file and a
 * buyer's are the same file and neither holds more than the shared page shows.
 */

/** How long the signed URL a photo is fetched through lives: well past one render. */
const IMAGE_URL_SECONDS = 5 * 60;
/** Photos fetched at once: enough to overlap round trips, few enough to stay polite to storage. */
const IMAGE_FETCH_CONCURRENCY = 8;

export type BookPdfResult =
  | { kind: 'ok'; pdf: Buffer; fileName: string }
  | { kind: 'refused'; status: 404 | 413; message: string }
  | { kind: 'failed' };

/** "Made 16 Oct 2026", in the owner's zone when the book has one and in UTC otherwise. */
export function describeGeneratedOn(now: Date, timeZone: string | null): string {
  const zone = timeZone && isKnownTimeZone(timeZone) ? timeZone : 'UTC';
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' }).format(now);
  return `Made ${day}${zone === 'UTC' ? ' (UTC)' : ''}`;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Every photo, read from the private bucket. Any one failing fails the file: a
 * copy of the history that silently leaves out a receipt is what the book
 * exists to rule out.
 */
async function readImages(paths: readonly string[], bookId: string): Promise<Buffer[] | null> {
  if (paths.length === 0) return [];
  const storage = createAdminClient().storage.from('service-book');
  const signed = await storage.createSignedUrls([...paths], IMAGE_URL_SECONDS);
  if (signed.error) {
    reportError('service-book-pdf', new Error(signed.error.message), { stage: 'sign', bookId });
    return null;
  }
  const urlByPath = new Map<string, string>();
  for (const entry of signed.data) {
    if (entry.path !== null && entry.error === null) urlByPath.set(entry.path, entry.signedUrl);
  }
  try {
    return await mapLimit(paths, IMAGE_FETCH_CONCURRENCY, async (path) => {
      const url = urlByPath.get(path);
      if (!url) throw new Error('no signed URL');
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`storage answered ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    });
  } catch (error) {
    reportError('service-book-pdf', error instanceof Error ? error : new Error(String(error)), { stage: 'fetch', bookId });
    return null;
  }
}

export async function renderBookPdf(bookId: string, request: PdfRequest, now = new Date()): Promise<BookPdfResult> {
  const rows = await loadSharedBook(bookId, { signThumbs: false });
  if (!rows) return { kind: 'failed' };

  const view = buildSharedBookView(rows.input);
  const plan = planBookPdf(view, request);
  if (plan.kind === 'no_such_year') return { kind: 'refused', status: 404, message: `This book has no entries from ${request.year}.` };
  if (plan.kind === 'too_many_images') return { kind: 'refused', status: 413, message: tooManyImagesMessage(plan.images) };

  const paths = plan.images.map((image) => rows.objectPathByAttachmentId.get(image.attachmentId));
  if (paths.some((path) => path === undefined)) {
    reportError('service-book-pdf', new Error('an attachment has no object path'), { bookId });
    return { kind: 'failed' };
  }
  const data = await readImages(paths as string[], bookId);
  if (!data) return { kind: 'failed' };
  const images: PdfImagePage[] = plan.images.map((image, index) => ({ caption: image.caption, data: data[index] }));

  try {
    const document = createElement(ServiceBookPdfDocument, {
      view: plan.view,
      request,
      images,
      generatedOn: describeGeneratedOn(now, rows.input.book.owner_time_zone),
    }) as unknown as ReactElement<DocumentProps>;
    const pdf = await renderToBuffer(document);
    return { kind: 'ok', pdf, fileName: pdfFileName(view.title, request) };
  } catch (error) {
    reportError('service-book-pdf', error instanceof Error ? error : new Error(String(error)), { stage: 'render', bookId });
    return { kind: 'failed' };
  }
}

/** How much of the file each streamed chunk carries. */
const RESPONSE_CHUNK_BYTES = 1024 * 1024;

/**
 * The response a rendered file goes out as: a download, never cached, never
 * indexed. STREAMED, not buffered, and that is load-bearing: Vercel refuses a
 * buffered function response over 4.5 MB with 413 FUNCTION_PAYLOAD_TOO_LARGE,
 * and a full file of 150 stored photos is about 65 MB. A streamed body is not
 * held to that limit, so the file is rendered whole first - a failure still
 * answers a clean 503 - and then written out in chunks with no Content-Length.
 */
export function pdfResponse(pdf: Buffer, fileName: string): Response {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= pdf.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + RESPONSE_CHUNK_BYTES, pdf.byteLength);
      controller.enqueue(new Uint8Array(pdf.subarray(offset, end)));
      offset = end;
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}
