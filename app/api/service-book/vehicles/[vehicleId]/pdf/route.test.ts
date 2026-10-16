import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOK_ID, pageCount, pdfText, threeEntryBook } from '@/tests/fixtures/service-book-pdf-book';

const { createAdminClient, createClient, getRealUser, isDemoMode, loadSharedBook } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getRealUser: vi.fn(),
  isDemoMode: vi.fn(),
  loadSharedBook: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/auth', () => ({ getRealUser }));
vi.mock('@/lib/demo/mode', () => ({ isDemoMode }));
vi.mock('@/lib/service-book-share', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/service-book-share')>()),
  loadSharedBook,
}));

import { GET } from '@/app/api/service-book/vehicles/[vehicleId]/pdf/route';

const VEHICLE_ID = '00000000-0000-4000-8000-0000000000e1';

function call(query: string, vehicleId = VEHICLE_ID) {
  return GET(new Request(`http://localhost/api/service-book/vehicles/${vehicleId}/pdf${query}`), { params: Promise.resolve({ vehicleId }) });
}

/** The rider's client: RLS answers with the book only when it is on one of their bikes. */
function riderOwns(book: { id: string } | null, error: { message: string; code?: string } | null = null) {
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: error ? null : book, error }) }));
  createClient.mockResolvedValue({ from: () => ({ select: () => ({ eq }) }) });
  return eq;
}

beforeEach(() => {
  isDemoMode.mockResolvedValue(false);
  getRealUser.mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000aa' });
  loadSharedBook.mockResolvedValue(threeEntryBook());
  createAdminClient.mockReturnValue({ storage: { from: () => ({ createSignedUrls: vi.fn() }) } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the owner's PDF of their service book", () => {
  it('renders the same file a share link gives, for a book RLS admits', async () => {
    const eq = riderOwns({ id: BOOK_ID });

    const response = await call('?variant=summary');
    const pdf = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    expect(pdfText(pdf)).toContain('1 entry removed by the owner');
    expect(pdfText(pdf)).not.toContain('removed note text');
    expect(eq).toHaveBeenCalledWith('vehicle_id', VEHICLE_ID);
    expect(loadSharedBook).toHaveBeenCalledWith(BOOK_ID, { signThumbs: false });
  });

  it("answers 404 for a bike that is not the rider's, reading nothing with the service role", async () => {
    riderOwns(null);

    const response = await call('?variant=summary');

    expect(response.status).toBe(404);
    expect(loadSharedBook).not.toHaveBeenCalled();
  });

  it('needs a signed-in rider', async () => {
    getRealUser.mockResolvedValue(null);

    expect((await call('?variant=summary')).status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('offers nothing in the demo, whose book is not rows', async () => {
    isDemoMode.mockResolvedValue(true);

    expect((await call('?variant=summary')).status).toBe(404);
    expect(getRealUser).not.toHaveBeenCalled();
  });

  it('reports a failed read rather than answering as though there were no book', async () => {
    riderOwns(null, { message: 'boom', code: '500' });

    expect((await call('?variant=summary')).status).toBe(503);
  });

  it('refuses a malformed bike id and an unknown variant', async () => {
    riderOwns({ id: BOOK_ID });

    expect((await call('?variant=summary', 'not-a-uuid')).status).toBe(404);
    expect((await call('?variant=poster')).status).toBe(400);
  });

  it('refuses a year with no entries', async () => {
    riderOwns({ id: BOOK_ID });

    expect((await call('?variant=full&year=2019')).status).toBe(404);
  });
});
