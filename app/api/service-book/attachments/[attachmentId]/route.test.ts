import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminClient, createClient, getRealUser, isDemoMode } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getRealUser: vi.fn(),
  isDemoMode: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/auth', () => ({ getRealUser }));
vi.mock('@/lib/demo/mode', () => ({ isDemoMode, assertNotDemoMode: vi.fn(async () => null) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { GET } from '@/app/api/service-book/attachments/[attachmentId]/route';
import { getServiceAttachmentLinks } from '@/lib/actions/service-attachments';
import { ATTACHMENT_READ_URL_SECONDS } from '@/lib/service-book/attachments';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const PHOTO_ID = '22222222-2222-4222-8222-222222222222';
const PDF_ID = '33333333-3333-4333-8333-333333333333';
const PART_ID = '44444444-4444-4444-8444-444444444444';

const PHOTO = {
  id: PHOTO_ID,
  entry_id: ENTRY_ID,
  kind: 'receipt',
  mime: 'image/jpeg',
  bytes: 120_000,
  uploaded_at: '2026-10-14T10:00:00Z',
  object_path: `book-1/${PHOTO_ID}.jpg`,
  thumb_path: `book-1/${PHOTO_ID}.thumb.jpg`,
};
const PART = {
  ...PHOTO,
  id: PART_ID,
  kind: 'photo',
  uploaded_at: '2026-10-14T10:10:00Z',
  object_path: `book-1/${PART_ID}.jpg`,
  thumb_path: `book-1/${PART_ID}.thumb.jpg`,
};
const PDF = {
  id: PDF_ID,
  entry_id: ENTRY_ID,
  kind: 'invoice',
  mime: 'application/pdf',
  bytes: 300_000,
  uploaded_at: '2026-10-14T10:05:00Z',
  object_path: `book-1/${PDF_ID}.pdf`,
  thumb_path: null,
};

type Answer = { data: unknown; error: { message: string; code?: string } | null };

/** The rider's client: `rows` are what RLS admits, filtered by the `.eq()` calls the code makes. */
function riderSees(rows: (typeof PHOTO | typeof PART | typeof PDF)[], failure: Answer['error'] = null) {
  createClient.mockResolvedValue({
    from: () => {
      const filters: [string, unknown][] = [];
      const matching = () => rows.filter((row) => filters.every(([column, value]) => (column === 'status' ? value === 'ready' : row[column as keyof typeof row] === value)));
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        order: async () => (failure ? { data: null, error: failure } : { data: matching(), error: null }),
        maybeSingle: async () => (failure ? { data: null, error: failure } : { data: matching()[0] ?? null, error: null }),
      };
      return query;
    },
  });
}

function storageSigns() {
  let minted = 0;
  const createSignedUrl = vi.fn(async (path: string, seconds: number) => {
    minted += 1;
    return { data: { signedUrl: `https://storage.test/sign/${path}?token=t${minted}&expires=${seconds}` }, error: null };
  });
  const createSignedUrls = vi.fn(async (paths: string[], seconds: number) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://storage.test/sign/${path}?batch&expires=${seconds}`, error: null })),
    error: null,
  }));
  createAdminClient.mockReturnValue({ storage: { from: () => ({ createSignedUrl, createSignedUrls }) } });
  return { createSignedUrl, createSignedUrls };
}

function open(href: string): Promise<Response> {
  const url = new URL(href, 'https://app.test');
  const attachmentId = url.pathname.split('/').at(-1) as string;
  return GET(new NextRequest(url), { params: Promise.resolve({ attachmentId }) });
}

describe('opening a service book attachment from the entry page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    isDemoMode.mockResolvedValue(false);
    getRealUser.mockResolvedValue({ id: 'rider-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleError.mockRestore();
  });

  it('signs every thumbnail in one batch as the page renders, without the route', async () => {
    riderSees([PHOTO, PART, PDF]);
    const { createSignedUrl, createSignedUrls } = storageSigns();

    const links = await getServiceAttachmentLinks('vehicle-1', ENTRY_ID);
    if (!links.ok) throw new Error(links.error);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith([PHOTO.thumb_path, PART.thumb_path], ATTACHMENT_READ_URL_SECONDS);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(links.data.map((link) => link.thumbUrl)).toEqual([
      `https://storage.test/sign/${PHOTO.thumb_path}?batch&expires=${ATTACHMENT_READ_URL_SECONDS}`,
      `https://storage.test/sign/${PART.thumb_path}?batch&expires=${ATTACHMENT_READ_URL_SECONDS}`,
      null,
    ]);
  });

  it('signs a fresh URL on each tap, so a page left open past the read TTL still opens every file', async () => {
    vi.useFakeTimers();
    riderSees([PHOTO, PDF]);
    const { createSignedUrl } = storageSigns();

    const links = await getServiceAttachmentLinks('vehicle-1', ENTRY_ID);
    if (!links.ok) throw new Error(links.error);
    expect(createSignedUrl).not.toHaveBeenCalled();
    const [photo, pdf] = links.data;

    vi.advanceTimersByTime((ATTACHMENT_READ_URL_SECONDS + 60) * 1000);

    const full = await open(photo.url);
    const document = await open(pdf.url);

    expect([full.status, document.status]).toEqual([302, 302]);
    expect(full.headers.get('location')).toBe(`https://storage.test/sign/${PHOTO.object_path}?token=t1&expires=${ATTACHMENT_READ_URL_SECONDS}`);
    expect(document.headers.get('location')).toBe(`https://storage.test/sign/${PDF.object_path}?token=t2&expires=${ATTACHMENT_READ_URL_SECONDS}`);
    expect(full.headers.get('cache-control')).toBe('private, no-store');
  });

  it('signs nothing for a signed-out caller', async () => {
    getRealUser.mockResolvedValue(null);
    riderSees([PHOTO]);
    const { createSignedUrl } = storageSigns();

    expect((await open(`/api/service-book/attachments/${PHOTO_ID}`)).status).toBe(401);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('signs nothing for an attachment the rider cannot select', async () => {
    riderSees([PDF]);
    const { createSignedUrl } = storageSigns();

    expect((await open(`/api/service-book/attachments/${PHOTO_ID}`)).status).toBe(404);
    expect((await open('/api/service-book/attachments/not-a-uuid')).status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('answers 503 and signs nothing when the row cannot be read', async () => {
    riderSees([PHOTO], { message: 'connection reset', code: '08006' });
    const { createSignedUrl } = storageSigns();

    expect((await open(`/api/service-book/attachments/${PHOTO_ID}`)).status).toBe(503);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
