import { ATTACHMENT_KIND_LABELS } from '@/lib/service-book/attachments';
import type { SharedBookView, SharedEntry } from '@/lib/service-book/shared-view';

/**
 * What a service book PDF holds (owner, Q5 and PQ4), decided from the same
 * `SharedBookView` the shared page prints, so the file can say nothing the page
 * does not: no rider id, no email, no session, and a removed entry only as the
 * count (PQ6). The owner's export and a share link's export are the same file.
 *
 * Two variants. **Summary** is the schedule and every entry with its labels, no
 * images. **Full** adds each photo attachment on a page of its own at the end.
 * A full file embeds at most `PDF_IMAGE_CAP` photos, because each one is fetched
 * from storage inside one function invocation of bounded duration; a book with
 * more is offered one full file per year instead. A PDF attachment is listed but
 * never embedded - a PDF cannot carry another PDF as an image.
 *
 * Pure: no Supabase, no Next, no renderer.
 */

/** The most photos one full PDF embeds. */
export const PDF_IMAGE_CAP = 150;

export type PdfVariant = 'summary' | 'full';

export interface PdfRequest {
  variant: PdfVariant;
  /** Full only: the one year of entries the file holds, or null for the whole book. */
  year: number | null;
}

/** One photo printed on an appendix page. */
export interface PdfImage {
  attachmentId: string;
  caption: string;
}

export interface PdfYear {
  year: number;
  entries: number;
  images: number;
  /** Whether a full file of this year fits under the cap. */
  fits: boolean;
}

/** What an export offers for a book: the full file whole, or year by year. */
export interface PdfOffer {
  images: number;
  /** True when the whole book fits in one full file. */
  wholeFull: boolean;
  /** Years with entries, newest first; offered as full files only when `wholeFull` is false. */
  years: PdfYear[];
}

export type PdfPlan =
  | {
      kind: 'ok';
      request: PdfRequest;
      /** The view the file prints: every entry, or one year's. */
      view: SharedBookView;
      images: PdfImage[];
    }
  | { kind: 'too_many_images'; images: number }
  | { kind: 'no_such_year' };

const YEAR_SHAPE = /^\d{4}$/;

/**
 * `?variant=summary|full[&year=YYYY]`, or null when it is not one of those. A
 * year names a full file only: a summary has no images to split.
 */
export function parsePdfRequest(params: URLSearchParams): PdfRequest | null {
  const variant = params.get('variant') ?? 'summary';
  const year = params.get('year');
  if (variant !== 'summary' && variant !== 'full') return null;
  if (year === null) return { variant, year: null };
  if (variant !== 'full' || !YEAR_SHAPE.test(year)) return null;
  return { variant, year: Number(year) };
}

function isImage(attachment: Pick<SharedEntry['attachments'][number], 'mime'>): boolean {
  return attachment.mime === 'image/jpeg';
}

function imagesOf(entries: readonly SharedEntry[]): PdfImage[] {
  return entries.flatMap((entry) =>
    entry.attachments
      .filter(isImage)
      .map((attachment) => ({
        attachmentId: attachment.id,
        caption: `${ATTACHMENT_KIND_LABELS[attachment.kind]} · ${entry.serviceDate} · ${entry.title}`,
      })),
  );
}

/** What an offer is counted from: a live entry's year and its attachments. */
export type PdfOfferEntry = Pick<SharedEntry, 'serviceYear'> & { attachments: readonly Pick<SharedEntry['attachments'][number], 'mime'>[] };

export function describePdfOffer(entries: readonly PdfOfferEntry[]): PdfOffer {
  const byYear = new Map<number, PdfYear>();
  for (const entry of entries) {
    if (entry.serviceYear === null) continue;
    const year = byYear.get(entry.serviceYear) ?? { year: entry.serviceYear, entries: 0, images: 0, fits: true };
    year.entries += 1;
    year.images += entry.attachments.filter(isImage).length;
    year.fits = year.images <= PDF_IMAGE_CAP;
    byYear.set(entry.serviceYear, year);
  }
  const images = entries.reduce((count, entry) => count + entry.attachments.filter(isImage).length, 0);
  return {
    images,
    wholeFull: images <= PDF_IMAGE_CAP,
    years: [...byYear.values()].sort((a, b) => b.year - a.year),
  };
}

export function planBookPdf(view: SharedBookView, request: PdfRequest): PdfPlan {
  if (request.variant === 'summary') return { kind: 'ok', request, view, images: [] };

  let scoped = view;
  if (request.year !== null) {
    const entries = view.entries.filter((entry) => entry.serviceYear === request.year);
    if (entries.length === 0) return { kind: 'no_such_year' };
    // The removed count stays the whole book's: the shared page prints no year
    // for a removed entry, so the file must not either.
    scoped = { ...view, entries };
  }
  const images = imagesOf(scoped.entries);
  if (images.length > PDF_IMAGE_CAP) return { kind: 'too_many_images', images: images.length };
  return { kind: 'ok', request, view: scoped, images };
}

/** Where a request's file is fetched from, relative to an export base such as `/book/<token>/pdf`. */
export function pdfQuery(request: PdfRequest): string {
  return request.year === null ? `?variant=${request.variant}` : `?variant=${request.variant}&year=${request.year}`;
}

/** `Blue-R6-service-book-full-2025.pdf`: the bike's name kept to letters, digits and dashes. */
export function pdfFileName(title: string, request: PdfRequest): string {
  const name =
    title
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'bike';
  const year = request.year === null ? '' : `-${request.year}`;
  return `${name}-service-book-${request.variant}${year}.pdf`;
}

/** The refusal a rider reads for a full file with too many photos. */
export function tooManyImagesMessage(images: number): string {
  return `This would hold ${images} photos, more than the ${PDF_IMAGE_CAP} one PDF can carry. Download the full PDF one year at a time, or the summary.`;
}

/**
 * The PDF standard fonts carry the Windows-1252 set and nothing else, and a
 * character outside it prints as stray glyphs. So anything else - an emoji in a
 * note, a script the font has no letters for - is printed as `?`, which at least
 * says something is missing.
 */
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

export function toPdfText(text: string): string {
  let out = '';
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0;
    const printable = char === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(char);
    out += printable ? char : '?';
  }
  return out;
}
