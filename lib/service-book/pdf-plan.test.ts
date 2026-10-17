import { describe, expect, it } from 'vitest';
import {
  PDF_IMAGE_CAP,
  describePdfOffer,
  parsePdfRequest,
  pdfFileName,
  pdfQuery,
  planBookPdf,
  toPdfText,
} from '@/lib/service-book/pdf-plan';
import type { SharedBookView, SharedEntry } from '@/lib/service-book/shared-view';

function shared(id: string, year: number | null, photos: number, pdfs = 0): SharedEntry {
  return {
    id,
    serviceDate: year === null ? 'someday' : `1 Jan ${year}`,
    serviceYear: year,
    title: 'Engine oil and filter',
    details: [],
    parts: [],
    notes: null,
    labels: [],
    attachments: [
      ...Array.from({ length: photos }, (_, index) => ({
        id: `${id}-photo-${index}`,
        entry_id: id,
        kind: 'receipt' as const,
        mime: 'image/jpeg' as const,
        bytes: 1,
        uploaded_at: null,
        created_at: '2026-01-01T00:00:00Z',
      })),
      ...Array.from({ length: pdfs }, (_, index) => ({
        id: `${id}-pdf-${index}`,
        entry_id: id,
        kind: 'invoice' as const,
        mime: 'application/pdf' as const,
        bytes: 1,
        uploaded_at: null,
        created_at: '2026-01-01T00:00:00Z',
      })),
    ],
  };
}

function view(entries: SharedEntry[], removedCount = 0): SharedBookView {
  return { title: 'R6', subtitle: null, readings: [], items: [], entries, removedCount, labelled: true };
}

describe('which PDF a request asks for', () => {
  it('reads the summary by default and a full file whole or by year', () => {
    expect(parsePdfRequest(new URLSearchParams(''))).toEqual({ variant: 'summary', year: null });
    expect(parsePdfRequest(new URLSearchParams('variant=full'))).toEqual({ variant: 'full', year: null });
    expect(parsePdfRequest(new URLSearchParams('variant=full&year=2025'))).toEqual({ variant: 'full', year: 2025 });
  });

  it('refuses anything else, and a year on a summary, which has no photos to split', () => {
    for (const query of ['variant=poster', 'variant=summary&year=2025', 'variant=full&year=25', 'variant=full&year=2025x']) {
      expect(parsePdfRequest(new URLSearchParams(query))).toBeNull();
    }
  });

  it('writes the request back as the query it came from', () => {
    for (const request of [{ variant: 'summary', year: null }, { variant: 'full', year: null }, { variant: 'full', year: 2024 }] as const) {
      expect(parsePdfRequest(new URLSearchParams(pdfQuery(request).slice(1)))).toEqual(request);
    }
  });
});

describe('what a PDF holds', () => {
  it('puts no photo in a summary', () => {
    const plan = planBookPdf(view([shared('a', 2026, 3)]), { variant: 'summary', year: null });
    expect(plan).toMatchObject({ kind: 'ok', images: [] });
  });

  it('embeds every photo in a full file and never a PDF attachment', () => {
    const plan = planBookPdf(view([shared('a', 2026, 2, 1)]), { variant: 'full', year: null });
    expect(plan.kind === 'ok' && plan.images.map((image) => image.attachmentId)).toEqual(['a-photo-0', 'a-photo-1']);
    expect(plan.kind === 'ok' && plan.images[0].caption).toBe('Receipt · 1 Jan 2026 · Engine oil and filter');
  });

  it(`holds a whole full file to ${PDF_IMAGE_CAP} photos, and a year file to its own year`, () => {
    const book = view([shared('a', 2026, 100), shared('b', 2025, 51)], 4);
    expect(planBookPdf(book, { variant: 'full', year: null })).toEqual({ kind: 'too_many_images', images: 151 });

    const year = planBookPdf(book, { variant: 'full', year: 2025 });
    expect(year.kind).toBe('ok');
    if (year.kind !== 'ok') return;
    expect(year.view.entries.map((entry) => entry.id)).toEqual(['b']);
    expect(year.images).toHaveLength(51);
    // The removed count stays the book's: the shared page gives no removed entry a year.
    expect(year.view.removedCount).toBe(4);

    expect(planBookPdf(book, { variant: 'full', year: 2019 })).toEqual({ kind: 'no_such_year' });
    expect(planBookPdf(view([shared('a', 2026, PDF_IMAGE_CAP)]), { variant: 'full', year: null }).kind).toBe('ok');
  });

  it('offers the full file whole while it fits, and year by year once it does not', () => {
    expect(describePdfOffer([shared('a', 2026, 2), shared('b', 2025, 0)])).toEqual({
      images: 2,
      wholeFull: true,
      years: [
        { year: 2026, entries: 1, images: 2, fits: true },
        { year: 2025, entries: 1, images: 0, fits: true },
      ],
    });

    const offer = describePdfOffer([shared('a', 2026, 151), shared('b', 2025, 10), shared('c', null, 1)]);
    expect(offer.wholeFull).toBe(false);
    expect(offer.years).toEqual([
      { year: 2026, entries: 1, images: 151, fits: false },
      { year: 2025, entries: 1, images: 10, fits: true },
    ]);
  });
});

describe('how a PDF is printed', () => {
  it('names the file after the bike in plain letters', () => {
    expect(pdfFileName('Blue R6', { variant: 'summary', year: null })).toBe('Blue-R6-service-book-summary.pdf');
    expect(pdfFileName('Café "racer" 🏍', { variant: 'full', year: 2025 })).toBe('Cafe-racer-service-book-full-2025.pdf');
    expect(pdfFileName('Blue R6 ÉTÉ 🏁', { variant: 'summary', year: null })).toBe('Blue-R6-ETE-service-book-summary.pdf');
    expect(pdfFileName('🏍', { variant: 'full', year: null })).toBe('bike-service-book-full.pdf');
  });

  it('keeps what the standard font can print and leaves out what it cannot', () => {
    expect(toPdfText('Motul 300V × 3 · $15 – “ok” Ünïcödé €')).toBe('Motul 300V × 3 · $15 – “ok” Ünïcödé €');
    expect(toPdfText('new\nline')).toBe('new\nline');
    expect(toPdfText('Blue R6 ÉTÉ 🏁')).toBe('Blue R6 ÉTÉ');
    expect(toPdfText('oil 🏍 done 日本')).toBe('oil done');
    expect(toPdfText('chain 🔗 lubed\n🏁 ready')).toBe('chain lubed\nready');
    // Composed rather than left as a letter and a combining mark the font lacks.
    expect(toPdfText('Café')).toBe('Café');
  });
});
