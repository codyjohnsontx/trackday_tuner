import { expect, test, type Page } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { makeRunId } from '@/tests/e2e/helpers/data';

const SESSION_DATE = '2099-12-31';
const BASELINE_TIME = '09:11';
const FOLLOW_UP_TIME = '09:22';

async function selectFirstVehicle(page: Page) {
  const vehicleSelect = page.getByLabel('Vehicle');
  const firstVehicleValue = await vehicleSelect.locator('option:not([disabled])').nth(0).getAttribute('value');
  const firstVehicleLabel = await vehicleSelect.locator('option:not([disabled])').nth(0).textContent();

  if (!firstVehicleValue) {
    throw new Error('Expected at least one vehicle option for the E2E account.');
  }

  await vehicleSelect.selectOption(firstVehicleValue);

  return {
    value: firstVehicleValue,
    label: firstVehicleLabel?.trim() ?? '',
  };
}

async function selectFirstTrack(page: Page) {
  const trackInput = page.getByLabel('Track');
  await trackInput.click();

  const firstTrackButton = page.locator('ul').filter({ has: page.getByRole('button') }).getByRole('button').first();
  await expect(firstTrackButton).toBeVisible();

  const label = (await firstTrackButton.textContent())?.trim() ?? '';
  const trackName = label.split(/\s{2,}/)[0]?.trim() || label;

  await firstTrackButton.click();
  await expect(trackInput).toHaveValue(trackName);

  return trackName;
}

async function createSession(
  page: Page,
  {
    sessionNumber,
    startTime,
    frontPressure,
    rearPressure,
    notes,
  }: {
    sessionNumber: string;
    startTime: string;
    frontPressure: string;
    rearPressure: string;
    notes: string;
  },
) {
  await page.getByLabel('Date').fill(SESSION_DATE);
  await page.getByLabel('Start Time').fill(startTime);
  await page.getByLabel('Session Number (optional)').fill(sessionNumber);
  await page.getByLabel('Front Pressure').fill(frontPressure);
  await page.getByLabel('Rear Pressure').fill(rearPressure);
  await page.getByLabel('Front Preload').fill('4');
  await page.getByLabel('Front Compression').fill('10');
  await page.getByLabel('Front Rebound').fill('8');
  await page.getByLabel('Rear Preload').fill('6');
  await page.getByLabel('Rear Compression').fill('12');
  await page.getByLabel('Rear Rebound').fill('10');
  await page.getByLabel('Notes').fill(notes);
  await page.getByRole('button', { name: 'Save Session' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
}

async function openSessionCard(page: Page, trackName: string, sessionNumber: string) {
  const sessionCard = page.locator('li').filter({
    has: page.getByRole('link', { name: new RegExp(`${trackName}.*S${sessionNumber}`) }),
  }).first();

  await expect(sessionCard).toBeVisible();
  await sessionCard.getByRole('link').click();
}

test.describe('session lifecycle and compare', () => {
  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');

  test('creates a baseline and follow-up session and shows compare output', async ({ page }) => {
    await signIn(page);

    const runId = makeRunId('pw-session');
    const baselineSessionNumber = String((Date.now() % 30000) + 1000);
    const followUpSessionNumber = String(Number(baselineSessionNumber) + 1);
    const baselineNotes = `PW baseline ${runId}`;
    const followUpNotes = `PW follow-up ${runId}`;

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();

    const vehicle = await selectFirstVehicle(page);
    const trackName = await selectFirstTrack(page);

    await createSession(page, {
      sessionNumber: baselineSessionNumber,
      startTime: BASELINE_TIME,
      frontPressure: '31',
      rearPressure: '24',
      notes: baselineNotes,
    });

    await openSessionCard(page, trackName, baselineSessionNumber);
    await expect(page.getByRole('heading', { name: trackName })).toBeVisible();
    await expect(page.getByText(vehicle.label)).toBeVisible();
    await expect(page.getByText(baselineNotes)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compare with Previous Session' })).toBeVisible();

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();
    await page.getByLabel('Vehicle').selectOption(vehicle.value);
    await page.getByLabel('Track').fill(trackName);
    await page.getByRole('button', { name: new RegExp(trackName) }).first().click();

    await createSession(page, {
      sessionNumber: followUpSessionNumber,
      startTime: FOLLOW_UP_TIME,
      frontPressure: '33',
      rearPressure: '24',
      notes: followUpNotes,
    });

    await openSessionCard(page, trackName, followUpSessionNumber);
    await expect(page.getByRole('heading', { name: trackName })).toBeVisible();
    await expect(page.getByText(followUpNotes)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compare with Previous Session' })).toBeVisible();
    await expect(page.getByText('Tires: Front Pressure')).toBeVisible();
    await expect(page.getByText('33')).toBeVisible();
    await expect(page.getByText('31')).toBeVisible();
    await expect(page.getByText('Notes')).toBeVisible();
    await expect(page.getByText(followUpNotes)).toBeVisible();
    await expect(page.getByText(baselineNotes)).toBeVisible();
  });
});
