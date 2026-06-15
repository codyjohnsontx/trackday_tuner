import { describe, expect, it, vi } from 'vitest';
import { DEMO_READ_ONLY_ERROR, assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === 'trackday_tuner_demo' && cookieValue.value ? { value: cookieValue.value } : undefined),
  })),
}));

describe('demo mode', () => {
  it('detects the demo cookie', async () => {
    cookieValue.value = '1';

    await expect(isDemoMode()).resolves.toBe(true);
    await expect(assertNotDemoMode()).resolves.toEqual({
      ok: false,
      error: DEMO_READ_ONLY_ERROR,
    });
  });

  it('returns false when the demo cookie is absent', async () => {
    cookieValue.value = undefined;

    await expect(isDemoMode()).resolves.toBe(false);
    await expect(assertNotDemoMode()).resolves.toBeNull();
  });
});
