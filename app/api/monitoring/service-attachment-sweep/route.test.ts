import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminClient, getMonitoringCronSecret } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getMonitoringCronSecret: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/env.server', () => ({ getMonitoringCronSecret }));

import { GET } from '@/app/api/monitoring/service-attachment-sweep/route';
import { STORAGE_REMOVE_BATCH_LIMIT } from '@/lib/storage-photo-removal';

const SECRET = 'cron-secret-value';

type Answer = { data: unknown; error: { message: string; code?: string } | null };

function adminAnswering(orphans: Answer, removed: Answer = { data: [], error: null }) {
  const rpc = vi.fn(async () => orphans);
  const remove = vi.fn(async () => removed);
  const storageFrom = vi.fn(() => ({ remove }));
  createAdminClient.mockReturnValue({ rpc, storage: { from: storageFrom } });
  return { rpc, remove, storageFrom };
}

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://app.test/api/monitoring/service-attachment-sweep', { headers });
}

function authorized(): NextRequest {
  return request({ authorization: `Bearer ${SECRET}` });
}

describe('GET /api/monitoring/service-attachment-sweep', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getMonitoringCronSecret.mockReturnValue(SECRET);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('refuses a caller without the scheduler secret and removes nothing', async () => {
    const { rpc, remove } = adminAnswering({ data: [{ name: 'book-1/a.jpg', created_at: '2026-10-01T00:00:00Z' }], error: null });

    expect((await GET(request())).status).toBe(401);
    expect((await GET(request({ authorization: 'Bearer wrong-secret-value' }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('answers 503 and removes nothing while the secret is not configured', async () => {
    getMonitoringCronSecret.mockImplementation(() => {
      throw new Error('Missing environment variable: MONITORING_CRON_SECRET');
    });
    const { rpc } = adminAnswering({ data: [], error: null });

    const response = await GET(authorized());

    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('removes every object the database lists as orphaned, one Storage batch at a time', async () => {
    const orphans = [
      { name: 'book-1/att-1.jpg', created_at: '2026-10-01T00:00:00Z' },
      { name: 'book-1/att-1.thumb.jpg', created_at: '2026-10-01T00:00:00Z' },
      { name: 'book-2/att-2.pdf', created_at: '2026-10-02T00:00:00Z' },
    ];
    const { rpc, remove, storageFrom } = adminAnswering(
      { data: orphans, error: null },
      { data: orphans.map(({ name }) => ({ name })), error: null },
    );

    const response = await GET(authorized());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', removed: 3 });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(rpc).toHaveBeenCalledWith('service_attachment_orphan_objects', { p_limit: STORAGE_REMOVE_BATCH_LIMIT });
    expect(storageFrom).toHaveBeenCalledWith('service-book');
    expect(remove).toHaveBeenCalledWith(['book-1/att-1.jpg', 'book-1/att-1.thumb.jpg', 'book-2/att-2.pdf']);
  });

  it('calls Storage not at all when nothing is orphaned', async () => {
    const { remove } = adminAnswering({ data: [], error: null });

    const response = await GET(authorized());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', removed: 0 });
    expect(remove).not.toHaveBeenCalled();
  });

  it('answers 503 so the workflow fails when the orphan listing fails', async () => {
    const { remove } = adminAnswering({ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } });

    const response = await GET(authorized());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'failed', error: 'orphan_read_failed' });
    expect(remove).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it('answers 503 so the workflow fails when Storage refuses the removal', async () => {
    adminAnswering(
      { data: [{ name: 'book-1/att-1.pdf', created_at: '2026-10-01T00:00:00Z' }], error: null },
      { data: null, error: { message: 'storage down' } },
    );

    const response = await GET(authorized());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'failed', error: 'remove_failed' });
    expect(consoleError).toHaveBeenCalled();
  });
});
