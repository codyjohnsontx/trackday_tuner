import { inflateSync } from 'node:zlib';
import type { ServiceEntryRecord } from '@/lib/service-book/book-data';
import type { SharedBookRows } from '@/lib/service-book-share';

/**
 * A three-entry service book as `loadSharedBook` returns it, for the PDF route
 * tests: two live entries in 2026 and one in 2025, the 2026 oil change carrying a
 * photo receipt and a PDF invoice, plus one removed entry whose words must
 * never reach a file.
 */

export const BOOK_ID = '00000000-0000-4000-8000-0000000000b0';
const ITEM_ID = '00000000-0000-4000-8000-0000000000c0';
const OWNER_ID = '00000000-0000-4000-8000-0000000000aa';

/** An 8x6 baseline JPEG, the smallest photo a full PDF can embed. */
export const TINY_JPEG = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAGAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAAHlhf//Z',
  'base64',
);

export function entry(id: string, extra: Partial<ServiceEntryRecord> = {}): ServiceEntryRecord {
  return {
    id,
    book_id: BOOK_ID,
    service_date: '2026-09-20',
    reading_hours: 41.5,
    reading_distance: null,
    performed_by: 'self',
    shop_name: null,
    cost_cents: 4500,
    currency: 'USD',
    notes: 'Motul 300V',
    custom_fields: {},
    origin: 'typed',
    logged_at: '2026-09-21T01:30:00Z',
    logged_by: OWNER_ID,
    revision: 1,
    deleted_at: null,
    copied_from_entry_id: null,
    created_at: '2026-09-21T01:30:00Z',
    updated_at: '2026-09-21T01:30:00Z',
    items: [{ id: `${id}-item`, entry_id: id, item_id: ITEM_ID, label: 'Engine oil and filter', created_at: '2026-09-21T01:30:00Z' }],
    parts: [],
    revisions: [{ revision: 1, kind: 'created', changed_at: '2026-09-21T01:30:00Z' }],
    attachments: [],
    ...extra,
  };
}

export function photo(id: string, entryId: string): ServiceEntryRecord['attachments'][number] {
  return { id, entry_id: entryId, kind: 'receipt', mime: 'image/jpeg', bytes: 120_000, uploaded_at: '2026-09-21T01:31:00Z', created_at: '2026-09-21T01:31:00Z' };
}

export const OIL_ID = '00000000-0000-4000-8000-000000000001';
export const PHOTO_ID = '00000000-0000-4000-8000-0000000000f1';
export const INVOICE_ID = '00000000-0000-4000-8000-0000000000f2';

export function threeEntryBook(entries?: ServiceEntryRecord[]): SharedBookRows {
  const list = entries ?? [
    entry(OIL_ID, {
      parts: [{ id: 'p1', entry_id: OIL_ID, entry_item_id: null, brand: 'Motul', part_number: '300V 10W40', quantity: 3, unit_cost_cents: 1500, created_at: '2026-09-21T01:30:00Z' }],
      attachments: [
        photo(PHOTO_ID, OIL_ID),
        { id: INVOICE_ID, entry_id: OIL_ID, kind: 'invoice', mime: 'application/pdf', bytes: 300_000, uploaded_at: '2026-09-21T01:32:00Z', created_at: '2026-09-21T01:32:00Z' },
      ],
    }),
    entry('00000000-0000-4000-8000-000000000002', { service_date: '2026-06-02', notes: 'Chain cleaned and adjusted' }),
    entry('00000000-0000-4000-8000-000000000003', { service_date: '2025-08-14', performed_by: 'shop', shop_name: 'Apex Moto', notes: null }),
    entry('00000000-0000-4000-8000-000000000004', { service_date: '2026-07-01', deleted_at: '2026-07-02T00:00:00Z', notes: 'removed note text' }),
  ];
  const objectPathByAttachmentId = new Map<string, string>();
  for (const record of list) {
    for (const attachment of record.attachments) {
      objectPathByAttachmentId.set(attachment.id, `${BOOK_ID}/${attachment.id}.${attachment.mime === 'image/jpeg' ? 'jpg' : 'pdf'}`);
    }
  }
  return {
    input: {
      vehicle: { nickname: 'Blue R6', type: 'motorcycle', year: 2019, make: 'Yamaha', model: 'YZF-R6' },
      book: { distance_unit: 'mi', owner_time_zone: 'America/Chicago' },
      fields: [],
      items: [
        {
          id: ITEM_ID,
          book_id: BOOK_ID,
          name: 'Engine oil and filter',
          interval_hours: 15,
          interval_distance: null,
          interval_days: null,
          source: 'starter',
          source_attachment_id: null,
          sort_order: 0,
          archived_at: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
      entries: list,
      readings: [],
    },
    thumbUrlByAttachmentId: new Map(),
    objectPathByAttachmentId,
  };
}

/** How many pages a PDF holds: its page objects, not its page tree. */
export function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
}

/**
 * The text a PDF prints, read back out of its compressed content streams: the
 * standard fonts write each run as hex, so joining every hex string of a page
 * gives its words (kerning numbers between them are dropped).
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const pages: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    const hex = [...content.matchAll(/<([0-9a-fA-F]+)>/g)].map((run) => run[1]).join('');
    if (hex) pages.push(Buffer.from(hex, 'hex').toString('latin1'));
  }
  return pages.join('\n');
}

/**
 * Where each "Page N of M" is drawn, read from the content streams: the y of
 * the box holding it, from the top of the page (react-pdf flips the axis), so
 * a footer on the page reads a little under the page height.
 */
export function pageNumberPositions(pdf: Buffer): { text: string; y: number }[] {
  const raw = pdf.toString('latin1');
  const found: { text: string; y: number }[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    let boxY: number | null = null;
    for (const line of content.split('\n')) {
      const box = line.match(/^1 0 0 1 44 (-?[\d.]+) cm$/);
      if (box) boxY = Number(box[1]);
      if (!line.endsWith('TJ')) continue;
      const text = Buffer.from([...line.matchAll(/<([0-9a-fA-F]+)>/g)].map((run) => run[1]).join(''), 'hex').toString('latin1');
      if (/^Page \d+ of \d+$/.test(text) && boxY !== null) found.push({ text, y: boxY });
    }
  }
  return found;
}
