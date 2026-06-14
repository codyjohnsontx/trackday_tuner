import { describe, expect, it, vi } from 'vitest';
import { DEMO_READ_ONLY_ERROR } from '@/lib/demo/mode';
import { createSession, getSessionCount, getSessions } from '@/lib/actions/sessions';
import { createTrack, getTracks } from '@/lib/actions/tracks';
import { createVehicle, getUserProfile, getVehicles } from '@/lib/actions/vehicles';
import type { CreateSessionInput } from '@/types';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => {
    throw new Error('Supabase should not be called in demo mode.');
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === 'trackday_tuner_demo' ? { value: '1' } : undefined),
    getAll: () => [{ name: 'trackday_tuner_demo', value: '1' }],
  })),
}));

const validSessionInput: CreateSessionInput = {
  vehicle_id: 'demo-r6',
  track_id: 'demo-track-msr-cresson',
  track_name: 'MSR Cresson 1.7',
  date: '2026-05-18',
  start_time: '15:00:00',
  session_number: 5,
  conditions: 'sunny',
  tires: {
    condition: 'scrubbed',
    front: { brand: 'Pirelli', compound: 'SC1', pressure: '33 psi hot' },
    rear: { brand: 'Pirelli', compound: 'SC2', pressure: '26 psi hot' },
  },
  suspension: {
    front: { preload: '5 turns', compression: '12 clicks', rebound: '10 clicks', direction: 'out' },
    rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
  },
  alignment: null,
  notes: 'demo write',
};

describe('demo action behavior', () => {
  it('returns demo vehicles and pro profile', async () => {
    await expect(getVehicles()).resolves.toMatchObject([{ id: 'demo-r6', nickname: 'R6 Track Bike' }]);
    await expect(getUserProfile()).resolves.toMatchObject({ id: 'demo-user', tier: 'pro' });
  });

  it('returns demo tracks and sessions', async () => {
    await expect(getTracks()).resolves.toHaveLength(3);
    await expect(getSessions()).resolves.toHaveLength(4);
    await expect(getSessionCount()).resolves.toBe(4);
  });

  it('blocks mutating actions with the demo read-only error', async () => {
    await expect(createVehicle({ nickname: 'Real Bike', type: 'motorcycle' })).resolves.toEqual({
      ok: false,
      error: DEMO_READ_ONLY_ERROR,
    });
    await expect(createTrack({ name: 'Real Track' })).resolves.toEqual({
      ok: false,
      error: DEMO_READ_ONLY_ERROR,
    });
    await expect(createSession(validSessionInput)).resolves.toEqual({
      ok: false,
      error: DEMO_READ_ONLY_ERROR,
    });
  });
});
