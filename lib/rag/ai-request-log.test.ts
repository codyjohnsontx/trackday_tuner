import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminClient, reportError } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/monitoring/report-error', () => ({ reportError }));

import { REDACTION_VERSION } from '@/lib/ai-observability';
import { describeRetainedText } from '@/lib/ai-question-retention';
import {
  buildSubmittedText,
  recordRefusedRequest,
  reservePendingSlot,
  updateRequestLog,
  type RiderTextSubmission,
} from '@/lib/rag/ai-request-log';
import { validateTuningAdviceRequest } from '@/lib/rag/validation';

const USER_ID = '11111111-1111-1111-1111-111111111111';

interface Write {
  table: string;
  op: 'insert' | 'update';
  row: Record<string, unknown>;
}

function adminMock(
  writes: Write[],
  { failRequestInsert = false, textInsert = 'ok' }: {
    failRequestInsert?: boolean;
    textInsert?: 'ok' | 'error' | 'throw';
  } = {},
) {
  return {
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        if (table === 'ai_requests' && failRequestInsert) return { error: { message: 'insert boom' } };
        if (table === 'ai_request_text' && textInsert === 'throw') throw new Error('transport boom');
        if (table === 'ai_request_text' && textInsert === 'error') return { error: { message: 'text boom' } };
        writes.push({ table, op: 'insert', row });
        return { error: null };
      }),
      update: vi.fn((row: Record<string, unknown>) => ({
        eq: vi.fn(async () => {
          writes.push({ table, op: 'update', row });
          return { error: null };
        }),
      })),
    })),
  };
}

const TUNING: RiderTextSubmission = {
  route: 'tuning_advice',
  question: 'Front pushes at 32.5 psi. Text me on 555 123 4567 or see https://example.com/setup',
  symptoms: ['understeer_entry'],
  changeIntent: 'sharper_turn_in',
};

const DAY_PLAN: RiderTextSubmission = {
  route: 'day_plan',
  trackName: 'Barber',
  weatherCondition: 'sunny, mail rider@example.com',
  surfaceCondition: null,
  targetDate: '2026-10-03',
};

function reserve(retainRiderText: boolean, riderText: RiderTextSubmission = TUNING) {
  return reservePendingSlot({
    logTag: 'test',
    userId: USER_ID,
    requestId: 'req-1',
    promptFingerprint: 'fp',
    promptRedactedPreview: 'the preview',
    retainRiderText,
    riderText,
  });
}

function refuse(retainRiderText: boolean, riderText: RiderTextSubmission = DAY_PLAN) {
  return recordRefusedRequest({
    logTag: 'test',
    userId: USER_ID,
    requestId: 'req-2',
    status: 'completed_refusal_prompt_injection',
    refusalReason: 'prompt_injection',
    classifierStage: 'preflight',
    promptFingerprint: 'fp',
    promptRedactedPreview: 'the preview',
    retainRiderText,
    riderText,
  });
}

let writes: Write[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  writes = [];
  createAdminClient.mockReturnValue(adminMock(writes));
});

describe('reservePendingSlot', () => {
  it('writes the preview and one redacted text row for a retaining rider', async () => {
    await reserve(true);

    expect(writes.map((w) => w.table)).toEqual(['ai_requests', 'ai_request_text']);
    expect(writes[0].row.prompt_redacted_preview).toBe('the preview');
    expect(writes[1].row).toEqual({
      request_id: 'req-1',
      user_id: USER_ID,
      route: 'tuning_advice',
      submitted: {
        question: 'Front pushes at 32.5 psi. Text me on [phone] or see [url]',
        symptoms: ['understeer_entry'],
        change_intent: 'sharper_turn_in',
      },
      redaction_version: REDACTION_VERSION,
    });
  });

  it('writes no text and a null preview for a rider who is not retaining', async () => {
    await reserve(false);

    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe('ai_requests');
    expect(writes[0].row.prompt_redacted_preview).toBeNull();
    expect(writes[0].row.prompt_fingerprint).toBe('fp');
  });

  it('still throws a reservation failure, and writes no text for it', async () => {
    createAdminClient.mockReturnValue(adminMock(writes, { failRequestInsert: true }));

    await expect(reserve(true)).rejects.toThrow('Rate limit reservation failed.');
    expect(writes).toHaveLength(0);
  });

  it.each(['error', 'throw'] as const)(
    'reports a text insert that returns %s and still resolves',
    async (textInsert) => {
      createAdminClient.mockReturnValue(adminMock(writes, { textInsert }));

      await expect(reserve(true)).resolves.toBeUndefined();
      expect(writes.map((w) => w.table)).toEqual(['ai_requests']);
      expect(reportError).toHaveBeenCalledWith('test', expect.anything(), {
        requestId: 'req-1',
        write: 'ai_request_text',
      });
    },
  );

  it('stamps app_commit from the deployment, and null without one', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123def');
    await reserve(false);
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    await reserve(false);

    expect(writes.map((w) => w.row.app_commit)).toEqual(['abc123def', null]);
  });
});

describe('recordRefusedRequest', () => {
  it('keeps the text of a refused request for a retaining rider', async () => {
    await refuse(true);

    expect(writes.map((w) => w.table)).toEqual(['ai_requests', 'ai_request_text']);
    expect(writes[0].row.prompt_redacted_preview).toBe('the preview');
    expect(writes[1].row).toMatchObject({
      request_id: 'req-2',
      route: 'day_plan',
      submitted: {
        track_name: 'Barber',
        weather_condition: 'sunny, mail [email]',
        surface_condition: null,
        target_date: '2026-10-03',
      },
    });
  });

  it('writes no text and a null preview for a rider who is not retaining', async () => {
    await refuse(false);

    expect(writes).toHaveLength(1);
    expect(writes[0].row.prompt_redacted_preview).toBeNull();
  });

  it('writes no text when the audit row it would hang off failed', async () => {
    createAdminClient.mockReturnValue(adminMock(writes, { failRequestInsert: true }));

    await refuse(true);

    expect(writes).toHaveLength(0);
  });
});

describe('updateRequestLog', () => {
  it('is the verdict path and never writes text or the preview', async () => {
    await updateRequestLog({
      logTag: 'test',
      requestId: 'req-1',
      status: 'ok',
      refusalReason: null,
      policyResult: 'allow',
      policyViolations: [],
      classifierStage: 'post_policy',
      sessionId: 'session',
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: 'ai_requests', op: 'update' });
    expect(writes[0].row).not.toHaveProperty('prompt_redacted_preview');
  });
});

describe('buildSubmittedText', () => {
  it('stores the tuning-advice fields the validator produces, under their wire names', () => {
    const validated = validateTuningAdviceRequest({
      vehicle_id: '22222222-2222-4222-8222-222222222222',
      session_id: '33333333-3333-4333-8333-333333333333',
      question: '  Front pushes on entry, what next?  ',
      symptoms: ['understeer_entry'],
      change_intent: 'sharper_turn_in',
    });
    if (!validated.ok) throw new Error(validated.error);

    const { route, submitted } = buildSubmittedText({
      route: 'tuning_advice',
      question: validated.data.question,
      symptoms: validated.data.symptoms ?? [],
      changeIntent: validated.data.change_intent ?? null,
    });

    expect(route).toBe('tuning_advice');
    expect(Object.keys(submitted).sort()).toEqual(['change_intent', 'question', 'symptoms']);
    expect(submitted.question).toBe(validated.data.question);
  });

  it('stores the day-plan fields as the migration documents them', () => {
    const { route, submitted } = buildSubmittedText(DAY_PLAN);

    expect(route).toBe('day_plan');
    expect(Object.keys(submitted).sort()).toEqual([
      'surface_condition',
      'target_date',
      'track_name',
      'weather_condition',
    ]);
  });

  it('is what the Settings list reads back', () => {
    const tuning = buildSubmittedText(TUNING);
    const plan = buildSubmittedText(DAY_PLAN);

    expect(describeRetainedText(tuning.route, tuning.submitted)).toBe(
      'Front pushes at 32.5 psi. Text me on [phone] or see [url] · Symptoms: Understeer on entry · Intent: Sharper turn-in',
    );
    expect(describeRetainedText(plan.route, plan.submitted)).toBe(
      'Barber · sunny, mail [email] · 2026-10-03',
    );
  });
});
