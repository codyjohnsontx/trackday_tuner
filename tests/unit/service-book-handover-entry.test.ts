import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A bike with no service book has nothing to hand over: the vehicle edit page
 * offers no handover link for it, and the handover screen sends a rider who
 * reaches it anyway to the book page, where a book can be started.
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/demo/mode', () => ({
  isDemoMode: vi.fn(async () => false),
  assertNotDemoMode: vi.fn(async () => null),
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/product-events.client', () => ({ trackProductEvent: vi.fn() }));

vi.mock('@/lib/actions/vehicles', () => ({
  getVehicle: vi.fn(),
  getVehicleDeletionCounts: vi.fn(),
  getUserProfile: vi.fn(async () => null),
  createVehicle: vi.fn(),
  updateVehicle: vi.fn(),
  deleteVehicle: vi.fn(),
}));

vi.mock('@/lib/actions/service-book', () => ({ getServiceBook: vi.fn() }));

vi.mock('@/lib/actions/service-book-transfers', () => ({
  hasServiceBook: vi.fn(),
  getServiceBookHandover: vi.fn(),
  getServiceBookHandoverCounts: vi.fn(),
  createServiceBookHandover: vi.fn(),
  cancelServiceBookHandover: vi.fn(),
}));

const { getVehicle, getVehicleDeletionCounts } = await import('@/lib/actions/vehicles');
const { getServiceBook } = await import('@/lib/actions/service-book');
const { hasServiceBook, getServiceBookHandover, getServiceBookHandoverCounts } = await import('@/lib/actions/service-book-transfers');
const { default: EditVehiclePage } = await import('@/app/(app)/garage/[id]/edit/page');
const { default: ServiceBookHandoverPage } = await import('@/app/(app)/garage/[id]/book/handover/page');

const VEHICLE_ID = '6f1c1f4e-5d0a-4c1b-9a8e-2b1d3c4e5f60';
const vehicle = { id: VEHICLE_ID, nickname: 'Blue R6', type: 'motorcycle', sold_at: null };

async function renderEditPage() {
  const element = await EditVehiclePage({ params: Promise.resolve({ id: VEHICLE_ID }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.mocked(getVehicle).mockResolvedValue({ ok: true, data: vehicle } as never);
  vi.mocked(getVehicleDeletionCounts).mockResolvedValue({
    ok: true,
    data: { sessionCount: 0, planSessionCount: 0, lapCount: 0, hasBaseline: false, recommendationCount: 0, hasRaceEngineerMemory: false },
  });
});

describe('the vehicle edit page', () => {
  it('offers no handover link for a bike with no service book', async () => {
    vi.mocked(hasServiceBook).mockResolvedValue(false);
    const html = await renderEditPage();
    expect(html).not.toContain(`/garage/${VEHICLE_ID}/book/handover`);
    expect(html).not.toContain('Selling it?');
  });

  it('links the handover for a bike that has one', async () => {
    vi.mocked(hasServiceBook).mockResolvedValue(true);
    const html = await renderEditPage();
    expect(html).toContain(`/garage/${VEHICLE_ID}/book/handover`);
  });
});

describe('the handover screen', () => {
  it('sends a bike with no service book to its book page rather than an error', async () => {
    vi.mocked(getServiceBook).mockResolvedValue({ ok: true, data: { vehicle, data: null } } as never);
    vi.mocked(getServiceBookHandover).mockResolvedValue({ ok: true, data: null });
    vi.mocked(getServiceBookHandoverCounts).mockResolvedValue({ ok: false, error: 'This bike has no service book yet.' });

    await expect(ServiceBookHandoverPage({ params: Promise.resolve({ id: VEHICLE_ID }) })).rejects.toThrow(
      `NEXT_REDIRECT /garage/${VEHICLE_ID}/book`,
    );
  });
});
