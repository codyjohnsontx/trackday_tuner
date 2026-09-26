import { describe, expect, it } from 'vitest';
import {
  currentRetentionChoice,
  describeRetainedText,
  planRetentionChange,
  resolveQuestionRetention,
  type RetentionProfile,
} from '@/lib/ai-question-retention';
import type { Json } from '@/types/supabase';

const NOW = '2026-09-25T12:00:00.000Z';
const EARLIER = '2026-09-01T12:00:00.000Z';

// The column the app no longer reads rides along, so each case shows the
// answer does not move with it.
type StoredProfile = RetentionProfile & { ai_question_retention_requires_opt_in: boolean };

function profile(overrides: Partial<StoredProfile> = {}): StoredProfile {
  return {
    ai_question_retention_notice_seen_at: null,
    ai_question_retention_opted_out_at: null,
    ai_question_retention_opted_in_at: null,
    ai_question_retention_requires_opt_in: false,
    ...overrides,
  };
}

describe('resolveQuestionRetention', () => {
  // Keeping is off until each rider turns it on (owner, 2026-09-25), and the
  // app holds to that without reading requires_opt_in: a database where
  // 20260925001800 has not landed still holds false there.
  it('keeps nothing for a rider who has not seen the notice', () => {
    expect(resolveQuestionRetention(profile())).toEqual({ noticeSeen: false, keeping: false });
  });

  it('keeps nothing for a rider with no profile row', () => {
    expect(resolveQuestionRetention(null).keeping).toBe(false);
  });

  it.each([false, true])(
    'keeps nothing for a rider who has only seen the notice, with requires_opt_in %s',
    (requiresOptIn) => {
      const seen = profile({
        ai_question_retention_notice_seen_at: EARLIER,
        ai_question_retention_requires_opt_in: requiresOptIn,
      });
      expect(resolveQuestionRetention(seen)).toEqual({ noticeSeen: true, keeping: false });
    },
  );

  it.each([false, true])('keeps once the rider has turned it on, with requires_opt_in %s', (requiresOptIn) => {
    const optedIn = profile({
      ai_question_retention_notice_seen_at: EARLIER,
      ai_question_retention_opted_in_at: NOW,
      ai_question_retention_requires_opt_in: requiresOptIn,
    });
    expect(resolveQuestionRetention(optedIn).keeping).toBe(true);
  });

  it('keeps nothing once the rider has turned it off', () => {
    const state = resolveQuestionRetention(
      profile({ ai_question_retention_notice_seen_at: EARLIER, ai_question_retention_opted_out_at: NOW }),
    );
    expect(state.keeping).toBe(false);
  });
});

describe('currentRetentionChoice', () => {
  it('presses no option before the notice is seen', () => {
    expect(currentRetentionChoice(resolveQuestionRetention(profile()))).toBeNull();
  });

  it('presses the option that matches the stored state', () => {
    const seen = profile({ ai_question_retention_notice_seen_at: EARLIER });
    expect(currentRetentionChoice(resolveQuestionRetention(seen))).toBe('off');
    const optedIn = { ...seen, ai_question_retention_opted_in_at: EARLIER };
    expect(currentRetentionChoice(resolveQuestionRetention(optedIn))).toBe('keep');
    expect(
      currentRetentionChoice(
        resolveQuestionRetention({ ...optedIn, ai_question_retention_opted_in_at: null, ai_question_retention_opted_out_at: NOW }),
      ),
    ).toBe('off');
  });
});

describe('planRetentionChange', () => {
  it('re-stamps opted_in_at and clears opted_out_at when a rider turns keeping back on', () => {
    // PR 1's obligation: a preview written while opted out must stay
    // unretainable, and the keep rule only counts rows written after the later
    // of notice_seen_at and opted_in_at.
    const state = resolveQuestionRetention(
      profile({ ai_question_retention_notice_seen_at: EARLIER, ai_question_retention_opted_out_at: EARLIER }),
    );
    expect(planRetentionChange(state, 'keep', NOW)).toEqual({
      profileUpdate: { ai_question_retention_opted_in_at: NOW, ai_question_retention_opted_out_at: null },
      deleteHeld: false,
    });
  });

  it('writes nothing when a rider who is keeping chooses keep again', () => {
    // A re-stamp here would make everything kept since the notice unretainable.
    const state = resolveQuestionRetention(
      profile({ ai_question_retention_notice_seen_at: EARLIER, ai_question_retention_opted_in_at: EARLIER }),
    );
    expect(planRetentionChange(state, 'keep', NOW)).toEqual({ profileUpdate: null, deleteHeld: false });
  });

  it('turning it off stamps opted_out_at, clears opted_in_at and deletes what is held', () => {
    const state = resolveQuestionRetention(
      profile({ ai_question_retention_notice_seen_at: EARLIER, ai_question_retention_opted_in_at: EARLIER }),
    );
    expect(planRetentionChange(state, 'off', NOW)).toEqual({
      profileUpdate: { ai_question_retention_opted_out_at: NOW, ai_question_retention_opted_in_at: null },
      deleteHeld: true,
    });
  });

  it('deletes what is held even when the rider was already off', () => {
    const state = resolveQuestionRetention(
      profile({ ai_question_retention_notice_seen_at: EARLIER, ai_question_retention_opted_out_at: EARLIER }),
    );
    expect(planRetentionChange(state, 'off', NOW).deleteHeld).toBe(true);
  });

  it('records the notice as seen when the rider chooses before answering it', () => {
    const state = resolveQuestionRetention(profile());
    expect(planRetentionChange(state, 'keep', NOW).profileUpdate).toMatchObject({
      ai_question_retention_notice_seen_at: NOW,
    });
    expect(planRetentionChange(state, 'off', NOW).profileUpdate).toMatchObject({
      ai_question_retention_notice_seen_at: NOW,
    });
  });

  it('never moves a notice_seen_at that is already set', () => {
    const state = resolveQuestionRetention(
      profile({ ai_question_retention_notice_seen_at: EARLIER, ai_question_retention_opted_out_at: EARLIER }),
    );
    expect(planRetentionChange(state, 'keep', NOW).profileUpdate).not.toHaveProperty(
      'ai_question_retention_notice_seen_at',
    );
    expect(planRetentionChange(state, 'off', NOW).profileUpdate).not.toHaveProperty(
      'ai_question_retention_notice_seen_at',
    );
  });

  it.each([false, true])(
    'turns keeping on for a rider who has only seen the notice, with requires_opt_in %s',
    (requiresOptIn) => {
      const state = resolveQuestionRetention(
        profile({ ai_question_retention_notice_seen_at: EARLIER, ai_question_retention_requires_opt_in: requiresOptIn }),
      );
      expect(planRetentionChange(state, 'keep', NOW).profileUpdate).toEqual({
        ai_question_retention_opted_in_at: NOW,
        ai_question_retention_opted_out_at: null,
      });
    },
  );

  it('answering "Not now" on the notice records an explicit off, with requires_opt_in false', () => {
    const state = resolveQuestionRetention(profile({ ai_question_retention_requires_opt_in: false }));
    expect(planRetentionChange(state, 'off', NOW)).toEqual({
      profileUpdate: {
        ai_question_retention_notice_seen_at: NOW,
        ai_question_retention_opted_out_at: NOW,
        ai_question_retention_opted_in_at: null,
      },
      deleteHeld: true,
    });
  });
});

describe('describeRetainedText', () => {
  it('joins a Race Engineer question, its symptom tags and its intent', () => {
    expect(
      describeRetainedText('tuning_advice', {
        question: 'Front pushes mid-corner.',
        symptoms: ['understeer_mid', 'front_push'],
        change_intent: 'better_feel',
      }),
    ).toBe(
      // A known chip prints its label; text that is not one of ours prints as is.
      'Front pushes mid-corner. · Symptoms: Understeer mid-corner, front_push · Intent: Better feel',
    );
  });

  it('joins the Morning Plan fields in order', () => {
    expect(
      describeRetainedText('day_plan', {
        track_name: 'Road America',
        weather_condition: 'Cool morning',
        surface_condition: 'Green track',
        target_date: '2026-10-03',
      }),
    ).toBe('Road America · Cool morning · Green track · 2026-10-03');
  });

  // `submitted` is jsonb behind a CHECK that it is an object and nothing else,
  // so the reader has to be total over what jsonb holds - a leaf that is not a
  // string is absent, and nothing throws out of the Settings page.
  it.each<[string, Json]>([
    ['a number leaf', { question: 5 }],
    ['a nested object', { question: { text: 'hi' } }],
    ['a boolean', { question: true }],
    ['a blank string', { question: '   ' }],
    ['no keys', {}],
    ['an array', ['question']],
    ['null', null],
    ['a string', 'question'],
  ])('reads %s as no text', (_label, submitted) => {
    expect(describeRetainedText('tuning_advice', submitted)).toBeNull();
  });

  it('drops a symptom tag that is not a string and keeps the rest', () => {
    expect(describeRetainedText('tuning_advice', { question: 'Loose rear.', symptoms: [3, 'oversteer_exit', null] })).toBe(
      'Loose rear. · Symptoms: Oversteer on exit',
    );
  });

  it('reads an unknown route as no text', () => {
    expect(describeRetainedText('recommendation_feedback', { question: 'x' })).toBeNull();
  });
});
