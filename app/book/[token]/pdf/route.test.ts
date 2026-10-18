import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOK_ID, INVOICE_ID, PHOTO_ID, TINY_JPEG, entry, pageCount, pdfText, photo, threeEntryBook } from '@/tests/fixtures/service-book-pdf-book';

const { createAdminClient, openShare, loadSharedBook } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  openShare: vi.fn(),
  loadSharedBook: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/service-book-share', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/service-book-share')>()),
  openShare,
  loadSharedBook,
}));

import { GET } from '@/app/book/[token]/pdf/route';

const TOKEN = 'a'.repeat(43);

function call(query: string) {
  return GET(new Request(`http://localhost/book/${TOKEN}/pdf${query}`), { params: Promise.resolve({ token: TOKEN }) });
}

/** The service role's client: the full-PDF allowance and photo signing. */
function admin({ limited = false } = {}) {
  const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: boolean; error: null }>>(async () => ({ data: limited, error: null }));
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://storage.test/${path}?token=signed`, error: null })),
    error: null,
  }));
  createAdminClient.mockReturnValue({ rpc, storage: { from: () => ({ createSignedUrls }) } });
  return { rpc, createSignedUrls };
}

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openShare.mockResolvedValue({ kind: 'open', bookId: BOOK_ID });
  loadSharedBook.mockResolvedValue(threeEntryBook());
  fetchMock = vi.fn(async () => new Response(new Uint8Array(TINY_JPEG), { status: 200 }));
  // Only storage is faked: the layout engine loads its own WebAssembly through fetch too.
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith('https://storage.test/') ? fetchMock(input, init) : realFetch(input, init),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('a shared service book as a PDF', () => {
  it('renders a three-entry book to a one-page summary', async () => {
    const { rpc } = admin();

    const response = await call('?variant=summary');
    const pdf = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="Blue-R6-service-book-summary.pdf"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    // Streamed with no length: Vercel refuses a buffered response over 4.5 MB.
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    // What the shared page prints, labelled in the owner's zone, and of the
    // removed entry only the count.
    const text = pdfText(pdf);
    expect(text).toContain('Blue R6');
    expect(text).toContain('Chain cleaned and adjusted');
    expect(text).toContain('Logged the day of service');
    expect(text).toContain('1 entry removed by an owner');
    expect(text).not.toContain('removed note text');
    expect(text).not.toContain('Jul 2026');
    // A download spends the link's rate limit but is not a view.
    expect(openShare).toHaveBeenCalledWith(TOKEN, { countView: false });
    // A summary reads no photo and spends no full-file allowance.
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds one page per photo to the full file, and never embeds a PDF attachment', async () => {
    const { rpc, createSignedUrls } = admin();

    const response = await call('?variant=full');
    const pdf = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(2);
    expect(createSignedUrls).toHaveBeenCalledWith([`${BOOK_ID}/${PHOTO_ID}.jpg`], expect.any(Number));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain(INVOICE_ID);
    expect(rpc).toHaveBeenCalledWith('consume_beta_rate_limit', expect.objectContaining({ p_limit: 10, p_window_seconds: 86_400 }));
    expect(rpc.mock.calls[0]?.[1].p_key_hash).toMatch(/^service-book-share-pdf:[0-9a-f]{64}$/);
  });

  it('refuses a full file once the link has spent its full files for the day', async () => {
    admin({ limited: true });

    const response = await call('?variant=full');

    expect(response.status).toBe(429);
    expect(loadSharedBook).not.toHaveBeenCalled();
  });

  it('answers a revoked or unknown link with the same 404 the page gives', async () => {
    admin();
    openShare.mockResolvedValue({ kind: 'not_found' });

    const response = await call('?variant=summary');

    expect(response.status).toBe(404);
    expect(loadSharedBook).not.toHaveBeenCalled();
  });

  it('holds a download to the link rate limit', async () => {
    admin();
    openShare.mockResolvedValue({ kind: 'rate_limited' });

    expect((await call('?variant=summary')).status).toBe(429);
  });

  it('refuses a variant it does not make', async () => {
    admin();

    expect((await call('?variant=everything')).status).toBe(400);
    expect((await call('?variant=summary&year=2026')).status).toBe(400);
  });

  it('offers the full file a year at a time past 150 photos', async () => {
    const { rpc } = admin();
    const many = (prefix: string, date: string, count: number) => {
      const id = `00000000-0000-4000-8000-${prefix}`;
      return entry(id, {
        service_date: date,
        attachments: Array.from({ length: count }, (_, index) => photo(`00000000-0000-4000-8${String(index).padStart(3, '0')}-${prefix}`, id)),
      });
    };
    loadSharedBook.mockResolvedValue(threeEntryBook([many('000000000a26', '2026-05-01', 100), many('000000000a25', '2025-05-01', 60)]));

    const whole = await call('?variant=full');
    expect(whole.status).toBe(413);
    expect((await whole.json()).error).toContain('160 photos');
    expect(fetchMock).not.toHaveBeenCalled();

    const year = await call('?variant=full&year=2025');
    const pdf = Buffer.from(await year.arrayBuffer());
    expect(year.status).toBe(200);
    expect(pageCount(pdf)).toBe(61);
    expect(fetchMock).toHaveBeenCalledTimes(60);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('fails the file rather than leave a photo out', async () => {
    admin();
    fetchMock.mockResolvedValue(new Response('gone', { status: 404 }));

    const response = await call('?variant=full');

    expect(response.status).toBe(503);
  });
});
