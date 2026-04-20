import { test, expect } from '@playwright/test';

const FREE_EMAIL = process.env.E2E_FREE_EMAIL;
const FREE_PASSWORD = process.env.E2E_FREE_PASSWORD;
const FREE_VEHICLE_ID = process.env.E2E_FREE_VEHICLE_ID;
const FREE_SESSION_ID = process.env.E2E_FREE_SESSION_ID;

function hasFreeTierFixture(): boolean {
  return Boolean(FREE_EMAIL && FREE_PASSWORD && FREE_VEHICLE_ID && FREE_SESSION_ID);
}

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

  test('rejects non-Pro accounts with 402', async ({ page }) => {
    test.skip(
      !hasFreeTierFixture(),
      'Requires E2E_FREE_EMAIL, E2E_FREE_PASSWORD, E2E_FREE_VEHICLE_ID, E2E_FREE_SESSION_ID to be set for a seeded free-tier account.',
    );

    await page.goto('/login');
    await page.getByLabel('Email').fill(FREE_EMAIL!);
    await page.getByLabel('Password').fill(FREE_PASSWORD!);
    await page.getByRole('button', { name: /^Sign In$/ }).first().click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Use the page's authenticated request context so login cookies are
    // carried; the standalone `request` fixture does not share state with
    // `page`.
    const response = await page.request.post('/api/ai/tuning-advice', {
      data: {
        vehicle_id: FREE_VEHICLE_ID!,
        session_id: FREE_SESSION_ID!,
        question: 'Front pushed mid-corner after raising pressure 1 psi; what should I try next?',
      },
    });
    expect(response.status()).toBe(402);
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
