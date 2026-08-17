import type { FeedbackOutcome, SessionCondition, TireCondition } from '@/types';

/**
 * What a rider actually told the app, as opposed to what the form opened with.
 *
 * Three rows used to seed their state with a default - `useState('sunny')`,
 * `useState('scrubbed')`, `useState(existing?.outcome ?? 'better')` - and every
 * one of those defaults was indistinguishable from an answer by the time it was
 * stored. A rider who never looked at the weather row filed "Sunny" against a
 * wet session, and a rider who saved an outcome without touching the verdict
 * taught the recommendation loop that the change had worked.
 *
 * So each of those is `null` until it is answered, and this module holds the
 * rules for what has to be answered before a save. `sessions.conditions` and
 * `session_feedback.outcome` are both NOT NULL, so those two are required rather
 * than stored empty; a tire condition is inside the `tires` JSON and is simply
 * left out when the rider did not say.
 */

export const SESSION_CONDITION_OPTIONS: readonly { value: SessionCondition; label: string }[] = [
  { value: 'sunny', label: 'Sunny' },
  { value: 'overcast', label: 'Overcast' },
  { value: 'rainy', label: 'Rainy' },
  { value: 'mixed', label: 'Mixed' },
];

export const TIRE_CONDITION_OPTIONS: readonly { value: TireCondition; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'scrubbed', label: 'Scrubbed' },
  { value: 'used', label: 'Used' },
  { value: 'worn', label: 'Worn' },
];

export const FEEDBACK_OUTCOME_OPTIONS: readonly { value: FeedbackOutcome; label: string }[] = [
  { value: 'better', label: 'Better' },
  { value: 'same', label: 'Same' },
  { value: 'worse', label: 'Worse' },
  { value: 'unknown', label: 'Unsure' },
];

export const MISSING_CONDITIONS_MESSAGE =
  'Choose the weather for this session. It is stored on the session, shown on your history and read by Race Engineer, so it cannot be guessed for you.';

export function isSessionCondition(value: unknown): value is SessionCondition {
  return SESSION_CONDITION_OPTIONS.some((option) => option.value === value);
}

/** A tire condition the rider chose, or null when they left the row alone. */
export function normalizeTireCondition(value: unknown): TireCondition | null {
  return TIRE_CONDITION_OPTIONS.some((option) => option.value === value)
    ? (value as TireCondition)
    : null;
}
