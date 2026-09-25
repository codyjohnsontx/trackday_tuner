import { INTENT_OPTIONS, SYMPTOM_OPTIONS, raceEngineerOptionLabel } from '@/lib/race-engineer-options';
import type { Json } from '@/types/supabase';
import type { Profile } from '@/types';

/**
 * Whether a rider's AI question text may be kept, read off their profile.
 *
 * Keeping is off until each rider turns it on (owner, 2026-09-25): text is
 * kept only when the notice has been seen, keeping has not been turned off, and
 * keeping has been turned on. `requires_opt_in` is not read. The database rule
 * - the `ai_requests_unretainable_previews` view, which the purge and
 * `/api/health` read - still lets a false `requires_opt_in` stand in for an
 * opt-in, and `20260925001800` makes it true for everyone; the app never relies
 * on that having been applied, so a rider who has only seen the notice is not
 * keeping here whatever the column holds. This is the rule asked about NOW
 * rather than about a row's write time, which is all a screen needs: what the
 * switch says, and whether the notice is still owed. A rider with no profile
 * row meets none of it.
 */
export type RetentionProfile = Pick<
  Profile,
  | 'ai_question_retention_notice_seen_at'
  | 'ai_question_retention_opted_out_at'
  | 'ai_question_retention_opted_in_at'
>;

export const RETENTION_PROFILE_COLUMNS =
  'ai_question_retention_notice_seen_at, ai_question_retention_opted_out_at, ai_question_retention_opted_in_at';

// The server action's failure messages. They live here rather than in
// `lib/actions/ai-question-retention.ts` because a 'use server' module may only
// export async functions.
export const RETENTION_LOAD_FAILED_MESSAGE = 'Your question history could not be loaded.';
export const RETENTION_SAVE_FAILED_MESSAGE = 'Your choice could not be saved. Try again.';
export const RETENTION_PROFILE_MISSING_MESSAGE =
  'Your account profile is missing, so this cannot be saved. Contact support.';
export const RETENTION_DELETE_FAILED_MESSAGE = 'The question could not be deleted. Try again.';
export const RETENTION_OPT_OUT_DELETE_FAILED_MESSAGE =
  'Question history is off, but the questions we hold could not all be deleted. Try again.';

export interface QuestionRetentionState {
  noticeSeen: boolean;
  keeping: boolean;
}

export function resolveQuestionRetention(profile: RetentionProfile | null): QuestionRetentionState {
  if (!profile) return { noticeSeen: false, keeping: false };

  const noticeSeen = profile.ai_question_retention_notice_seen_at !== null;
  const keeping =
    noticeSeen &&
    profile.ai_question_retention_opted_out_at === null &&
    profile.ai_question_retention_opted_in_at !== null;

  return { noticeSeen, keeping };
}

export type QuestionRetentionChoice = 'keep' | 'off';

/**
 * The option the Settings switch shows as pressed. `null` until the rider has
 * seen the notice: nothing of theirs is kept then, but they have not chosen
 * "Do not keep" either, and a pressed option would say they had.
 */
export function currentRetentionChoice(state: QuestionRetentionState): QuestionRetentionChoice | null {
  if (!state.noticeSeen) return null;
  return state.keeping ? 'keep' : 'off';
}

export type RetentionProfileUpdate = Partial<RetentionProfile>;

export interface RetentionChangePlan {
  /** Columns to write on the rider's profile, or null when nothing changes. */
  profileUpdate: RetentionProfileUpdate | null;
  /** Delete every held text row and null every preview, in the same action. */
  deleteHeld: boolean;
}

/**
 * What a rider's choice writes. Pure so the one rule that matters here is
 * testable without a database:
 *
 * TURNING KEEPING ON RE-STAMPS `opted_in_at`, and choosing it while ALREADY
 * keeping writes nothing. Both follow from the keep rule judging consent as of
 * when text was written - a preview counts only if written after the later of
 * `notice_seen_at` and `opted_in_at`. Re-stamping on the way back in is what
 * keeps a preview written while opted out unretainable (PR 1's obligation on
 * this step). Re-stamping a rider who never left would do the opposite of what
 * they asked, making everything they had agreed to keep unretainable at once.
 *
 * Turning keeping off stamps `opted_out_at`, clears `opted_in_at` and deletes
 * what is held (owner decision D3), and it deletes even when the rider was
 * already off, because "turning this off deletes what we hold" has to be true
 * every time the rider presses it.
 *
 * Either choice records the notice as seen if it was not: the Settings card
 * carries the notice's words, so a rider choosing there has read them.
 */
export function planRetentionChange(
  state: QuestionRetentionState,
  choice: QuestionRetentionChoice,
  nowIso: string,
): RetentionChangePlan {
  const seen: RetentionProfileUpdate = state.noticeSeen
    ? {}
    : { ai_question_retention_notice_seen_at: nowIso };

  if (choice === 'keep') {
    if (state.keeping) return { profileUpdate: null, deleteHeld: false };
    return {
      profileUpdate: {
        ...seen,
        ai_question_retention_opted_in_at: nowIso,
        ai_question_retention_opted_out_at: null,
      },
      deleteHeld: false,
    };
  }

  return {
    profileUpdate: {
      ...seen,
      ai_question_retention_opted_out_at: nowIso,
      ai_question_retention_opted_in_at: null,
    },
    deleteHeld: true,
  };
}

export type RetainedQuestionRoute = 'tuning_advice' | 'day_plan';

export interface RetainedQuestion {
  requestId: string;
  route: RetainedQuestionRoute;
  /** The held text as one line, or null when the row holds none readable. */
  text: string | null;
  createdAt: string;
  retainUntil: string;
}

export interface RetainedQuestionHistory {
  /** The newest held rows, at most the page the list shows. */
  questions: RetainedQuestion[];
  /** Every row held, which is more than `questions` once the list is cut. */
  total: number;
}

function stringLeaf(value: Json | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The held text of one row, as the rider reads it in their list.
 *
 * `submitted` is `jsonb` and nothing but a CHECK that it is an object stands
 * behind its shape, so this reads it the way `formatValue` in
 * `lib/rag/prompt.ts` reads a setup leaf: a string renders, anything else is
 * absent. A number, a nested object or a missing key never throws out of the
 * Settings page. Symptom tags are an array of strings and render as a list, printed as the
 * label the rider picked rather than the id the request carried.
 */
export function describeRetainedText(route: string, submitted: Json): string | null {
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return null;

  const parts: string[] = [];
  const push = (value: Json | undefined) => {
    const text = stringLeaf(value);
    if (text) parts.push(text);
  };

  if (route === 'tuning_advice') {
    push(submitted.question);
    const symptoms = submitted.symptoms;
    if (Array.isArray(symptoms)) {
      const tags = symptoms
        .map((tag) => stringLeaf(tag))
        .filter((tag): tag is string => tag !== null)
        .map((tag) => raceEngineerOptionLabel(SYMPTOM_OPTIONS, tag));
      if (tags.length > 0) parts.push(`Symptoms: ${tags.join(', ')}`);
    }
    const intent = stringLeaf(submitted.change_intent);
    if (intent) parts.push(`Intent: ${raceEngineerOptionLabel(INTENT_OPTIONS, intent)}`);
  } else if (route === 'day_plan') {
    push(submitted.track_name);
    push(submitted.weather_condition);
    push(submitted.surface_condition);
    push(submitted.target_date);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
