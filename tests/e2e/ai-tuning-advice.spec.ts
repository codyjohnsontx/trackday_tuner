import { test, expect } from '@playwright/test';

test.describe('/api/ai/tuning-advice', () => {
  test('rejects unauthenticated requests with 401', async ({ request }) => {
    const response = await request.post('/api/ai/tuning-advice', {
      data: {
        vehicle_id: '11111111-1111-1111-1111-111111111111',
        session_id: '22222222-2222-2222-2222-222222222222',
        question: 'Front pushes mid-corner after raising pressure 1 psi.',
      },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.request_id).toBeTruthy();
  });

  test('rejects malformed bodies with 400', async ({ request }) => {
    const response = await request.post('/api/ai/tuning-advice', {
      data: { question: 'too short body' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });

  test('rejects unknown fields with 400', async ({ request }) => {
    const response = await request.post('/api/ai/tuning-advice', {
      data: {
        vehicle_id: '11111111-1111-1111-1111-111111111111',
        session_id: '22222222-2222-2222-2222-222222222222',
        question: 'This is a long enough question body.',
        backdoor: true,
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(String(body.error)).toContain('Unknown field');
  });

  test('rejects invalid JSON with 400', async ({ request }) => {
    const response = await request.post('/api/ai/tuning-advice', {
      headers: { 'content-type': 'application/json' },
      data: '{not json',
    });
    expect(response.status()).toBe(400);
  });
});
