/**
 * The one definition of which setup changes exist.
 *
 * `evaluateAdvicePolicy` enforces this vocabulary, and until now it was the
 * ONLY place it appeared: `SYSTEM_PROMPT` never named a component, the response
 * schema types `component` and `direction` as bare strings, and the canonical
 * spelling survived only as an example in `docs/ai-mvp-spec.md`. So the model
 * was asked to produce words it had never been shown and then refused for
 * guessing them - the repository's own fixture recommends `front_rebound` /
 * `softer` / `1 click`, which the policy rejects as `unsupported_direction`
 * because it accepts `soften` and not `softer`. One letter, and a real
 * recommendation is withheld from the rider.
 *
 * `describeComponentVocabulary()` generates the prompt text FROM this table, so
 * what the model is told and what the policy enforces cannot disagree. Add a
 * component or a direction here and both sides learn about it together; there
 * is no second list to remember.
 */

export type ComponentKey =
  | 'tire_pressure'
  | 'toe'
  | 'rebound'
  | 'compression'
  | 'camber'
  | 'sprocket'
  | 'wing_angle'
  | 'geometry';

export interface ComponentPolicy {
  /** Exact `component` strings the model may emit, first entry listed first. */
  aliases: string[];
  /** Exact `direction` words or phrases the model may emit. */
  directions: string[];
  /** Human label for the magnitude unit, used in the prompt. */
  unit: string;
  /**
   * What `magnitude` must contain. Kept explicit rather than derived from
   * `unit` so the enforced matcher is provably the one it always was.
   */
  unitPattern: RegExp;
  /** Largest absolute magnitude allowed, in `unit`. */
  maxMagnitude: number;
}

export const COMPONENT_POLICIES: Record<ComponentKey, ComponentPolicy> = {
  tire_pressure: {
    aliases: [
      'front_tire_pressure',
      'rear_tire_pressure',
      'front_and_rear_cold_pressure',
      'front tire pressure',
      'rear tire pressure',
      'front and rear cold pressure',
    ],
    directions: ['increase', 'decrease', 'raise', 'lower'],
    unit: 'psi',
    unitPattern: /\bpsi\b/i,
    maxMagnitude: 1,
  },
  toe: {
    aliases: ['front_toe', 'rear_toe', 'front toe', 'rear toe'],
    directions: ['toe-in', 'toe-out', 'increase', 'decrease'],
    unit: 'mm',
    unitPattern: /\bmm\b/i,
    maxMagnitude: 3,
  },
  rebound: {
    aliases: ['front_rebound', 'rear_rebound', 'front rebound', 'rear rebound'],
    directions: ['stiffen', 'soften', 'increase', 'decrease'],
    unit: 'clicks',
    unitPattern: /\bclicks?\b/i,
    maxMagnitude: 2,
  },
  compression: {
    aliases: ['front_compression', 'rear_compression', 'front compression', 'rear compression'],
    directions: ['stiffen', 'soften', 'increase', 'decrease'],
    unit: 'clicks',
    unitPattern: /\bclicks?\b/i,
    maxMagnitude: 2,
  },
  camber: {
    aliases: ['front_camber', 'rear_camber', 'front camber', 'rear camber'],
    directions: ['increase', 'decrease', 'reduce negative camber', 'increase negative camber'],
    unit: 'degrees',
    unitPattern: /\bdegrees?\b/i,
    maxMagnitude: 0.5,
  },
  sprocket: {
    aliases: ['rear_sprocket', 'front_sprocket', 'rear sprocket', 'front sprocket'],
    directions: ['shorter gearing', 'taller gearing', 'increase', 'decrease'],
    unit: 'teeth',
    unitPattern: /\b(?:tooth|teeth)\b/i,
    maxMagnitude: 2,
  },
  wing_angle: {
    aliases: ['rear_wing_angle', 'front_wing_angle', 'rear wing angle', 'front wing angle'],
    directions: ['increase', 'decrease'],
    unit: 'positions',
    unitPattern: /\bpositions?\b/i,
    maxMagnitude: 2,
  },
  geometry: {
    aliases: ['fork_height', 'rear_ride_height', 'fork height', 'rear ride height'],
    directions: ['increase', 'decrease', 'raise', 'lower'],
    unit: 'mm',
    unitPattern: /\bmm\b/i,
    maxMagnitude: 3,
  },
};

/**
 * The one normalization of a `direction` string, shared by the guard below and
 * by `formatDirectionLabel` further down.
 *
 * Folding casing, surrounding whitespace and the separator run means the two
 * halves cannot disagree about what a value IS - one of them deciding `toe_in`
 * is the canonical `toe-in` while the other decides it is a stranger is exactly
 * the drift this table exists to prevent.
 */
function directionKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, ' ');
}

/**
 * Whether the model's `direction` is one this component actually offers.
 *
 * THIS IS AN ALLOWLIST OF EXACT VALUES, AND IT HAS TO BE. It used to match by
 * word-boundary CONTAINMENT - `/\bincrease\b/i.test(direction)` - which asks
 * whether the canonical word appears somewhere in the string rather than
 * whether the string IS that word. So `do not increase` and `never increase`
 * both passed, arriving with a valid component and a legal magnitude, and were
 * stored in `ai_recommendations` and rendered to the rider as a checked
 * recommendation instructing the opposite of what the model wrote. A survey of
 * the vocabulary against thirteen ordinary negation and hedging prefixes
 * accepted 518 such values.
 *
 * That is PRE-EXISTING behaviour rather than a regression: before this table
 * existed `evaluateAdvicePolicy` ran `policy.directionPatterns.some(p =>
 * p.test(change.direction))` over the same `/\bincrease\b/i` patterns, and the
 * move into this module preserved the semantics exactly. Tightening it here is
 * a deliberate change of behaviour.
 *
 * DETECTING NEGATION WOULD BE THE WRONG FIX. A blocklist of "do not", "never",
 * "avoid", "rather than" is an arms race against English, and it loses: the
 * survey above only had to reach for "under no circumstances" to find a
 * thirteenth prefix. An allowlist of exact accepted values ends the race,
 * because a negation cannot be spelled without adding a word and any added word
 * fails equality. `SYSTEM_PROMPT` is what makes equality affordable -
 * `describeComponentVocabulary()` now prints these exact strings to the model
 * and tells it to use them rather than a paraphrase, so the model is finally
 * being asked for the thing it is graded on.
 *
 * WHAT IS FOLDED, AND WHY EACH ONE. Casing, because JSON from a model varies it
 * freely and it carries no meaning here. Surrounding whitespace, for the same
 * reason. The separator run - `_`, `-`, and runs of spaces collapsed to one -
 * because `directionKey` above already folds it for the rider-facing label, and
 * because the component axis of this same table lists `front_toe` AND
 * `front toe` as aliases, so a model that underscores a multi-word value is a
 * shape the table already anticipates on the other axis. Folding the separator
 * is the one place this WIDENS rather than tightens: `toe_in`, `toe in` and
 * `shorter_gearing` were refused by the containment matcher and are accepted
 * here. It cannot admit a negation, because a negation adds a word rather than
 * changing a separator.
 *
 * WHAT IT NOW REFUSES THAT IT USED TO ACCEPT, beyond the negations. A paraphrase
 * that names the component back at you (`increase tire pressure`, `soften front
 * rebound`) - the prompt asks for the bare direction, and this is the one shape
 * a live model might still produce, so the cost of this change is a refusal
 * there rather than bad advice. That cost is tracked, carrying the open question
 * of whether a live model actually emits the canonical strings at all; the echo
 * path below is filed against it as the next task. An ambiguous value carrying
 * two intents (`increase or decrease depending on grip`). A direction curated
 * for a DIFFERENT component: `tire_pressure` accepted `increase negative
 * camber` because that phrase contains `increase`, and `camber` accepted the
 * uncurated `decrease negative camber` for the same reason. Equality is per
 * policy, so each component now only answers to the directions listed against
 * it.
 *
 * THE PARAPHRASE COST IS NOT QUITE SELF-LIMITING. A paraphrase the old
 * containment matcher accepted was persisted raw, and
 * `formatRaceEngineerContext` in `lib/rag/prompt.ts` prints stored directions
 * straight back into the prompt as `direction=<value>`, on the stated grounds
 * that the canonical identifier is the point (the wire half of the split
 * recorded on `formatComponentLabel` below) - WHICH IS FALSE FOR A STORED
 * PARAPHRASE, and that sentence is where the fix goes. A refused request writes
 * no row, because `persistRecommendation` returns before the insert, and
 * `save_session_outcome` only updates status, so nothing displaces a
 * `created_at`-ordered window: while refusals continue, the same paraphrase
 * keeps being echoed back. It is STICKY RATHER THAN SEALED - the model must
 * still choose to copy it while this same prompt tells it not to, and one
 * canonical response writes a newer row that pushes it down. It is bounded three
 * ways: to a single (`user_id`, `vehicle_id`); day-plan is untouched because
 * `recentRecommendations` is always empty there, so a working AI route always
 * remains; and `completed_refusal_unsupported_direction` is in neither
 * throttled-status list, so repeated refusals cannot escalate into a lockout.
 * The fix belongs in `prompt.ts` and is deliberately NOT on this branch, because
 * `formatRaceEngineerContext` is shared prompt output on BOTH AI routes and that
 * blast radius is out of scope here.
 *
 * `magnitudeAllowed` below still matches its unit by containment, and that is
 * NOT the same class: a magnitude is inherently a phrase (`0.5 psi`), so there
 * is no closed set to compare against. Containment holds there for PADDING and
 * NOT for SIGN, and the difference is a KNOWN ACCEPTED GAP rather than a
 * property of the matcher. `parseRangeMax` takes the LARGEST number in the
 * string, so extra prose can only raise the figure the ceiling is checked
 * against and can only make it stricter. But it takes that number through
 * `Math.abs`, so a NEGATIVE magnitude clears the ceiling today:
 * `{component: 'front_rebound', direction: 'soften', magnitude: '-1 click'}`
 * passes both guards, is persisted, and reaches the rider rendered raw beside
 * the now-guaranteed-canonical direction as `Soften · -1 click`, because the
 * display/wire split deliberately leaves `magnitude` unformatted. That is the
 * same shape this guard just closed on the sibling field - a checked
 * recommendation whose rendered text no longer means what the vocabulary
 * verified.
 *
 * The correction is recorded here rather than fixed here because that earlier
 * sentence claimed the gap away, and a false justification is worse than an
 * undocumented gap: the gap is merely unknown, while the justification actively
 * talks the next reader out of ever opening `parseRangeMax`. A comment that
 * defends a bug outlives the code. The gap is pre-existing and out of scope for
 * this change, and is tracked as tt-negative-magnitude-accepted; the earliest
 * shared boundary for closing it is `parseRangeMax` / `magnitudeAllowed`, not a
 * render site. `findComponentPolicy` was already exact.
 *
 * Nothing already stored is re-checked here - `ai_recommendations` rows are read
 * back through `formatDirectionLabel`, which passes an unrecognised value
 * through unchanged - so tightening this cannot retroactively refuse a row a
 * rider has already been shown.
 */
export function directionAllowed(policy: ComponentPolicy, direction: string): boolean {
  const key = directionKey(direction);
  return policy.directions.some((allowed) => directionKey(allowed) === key);
}

function parseRangeMax(value: string): number | null {
  const matches = [...value.matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (matches.length === 0 || matches.some((entry) => !Number.isFinite(entry))) return null;
  return Math.max(...matches.map((entry) => Math.abs(entry)));
}

export function magnitudeAllowed(policy: ComponentPolicy, magnitude: string): boolean {
  return (
    policy.unitPattern.test(magnitude) &&
    (parseRangeMax(magnitude) ?? Infinity) <= policy.maxMagnitude
  );
}

export function findComponentPolicy(component: string): ComponentPolicy | null {
  const normalized = component.trim().toLowerCase();
  for (const [key, policy] of Object.entries(COMPONENT_POLICIES) as [ComponentKey, ComponentPolicy][]) {
    if (key === normalized || policy.aliases.includes(normalized)) return policy;
  }
  return null;
}

/**
 * The rider-facing rendering of a `component` string.
 *
 * The wire vocabulary is identifiers - the model is told to emit
 * `rear_tire_pressure` exactly, because that is what the policy checks - and the
 * panels used to print whatever arrived straight onto the screen, so a rider
 * read `rear_tire_pressure` where the copy had once said "Tire pressures".
 * Formatting here rather than reordering the prompt's alias list is deliberate:
 * what a rider sees must not depend on the model choosing the prettier synonym.
 *
 * Anything this table does not recognise is returned unchanged, and that is
 * load-bearing rather than defensive: `ai_recommendations` rows written before
 * the vocabulary existed hold prose like "Front setup", and they still have to
 * read correctly in the outcome picker years later.
 *
 * WHERE IT BELONGS, AND WHERE IT MUST NOT GO. Two sites render a component to a
 * rider and both call this: `components/ai/advice-report.tsx`, the one place an
 * `AdviceResponse` becomes a screen, and the "AI recommendation tested" select
 * in `components/sessions/session-outcome-panel.tsx`, whose rows come from
 * `getOutcomeReferences` in `lib/actions/outcomes.ts`. It was four while the two
 * AI panels each rendered the payload themselves. Three sites read a
 * component and must stay RAW: `app/api/ai/tuning-advice/route.ts` writes the
 * wire value to storage, `lib/rag/prompt.ts` renders it back into the model
 * prompt where the canonical identifier is the point, and `evaluateAdvicePolicy`
 * matches it against the table. The split is display versus wire, not
 * convenience.
 *
 * That list was assembled by grepping `\.component` across `app`, `components`,
 * `lib` and `scripts`, then tracing every consumer of `ai_recommendations`; the
 * CSV export carries no component field and `scripts/eval-rag.mjs` only checks
 * the shape, so neither is rider-facing. Repeat that sweep rather than adding a
 * third site by accident - this helper was added for the AI panels and the
 * outcome picker was found separately, afterwards.
 */
export function formatComponentLabel(component: string): string {
  if (!findComponentPolicy(component)) return component;
  const spaced = component.trim().toLowerCase().replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const DIRECTION_LABELS = new Map<string, string>(
  Object.values(COMPONENT_POLICIES).flatMap((policy) =>
    policy.directions.map(
      (direction): [string, string] => [
        directionKey(direction),
        direction.charAt(0).toUpperCase() + direction.slice(1),
      ],
    ),
  ),
);

/**
 * The same job for `direction`, which is the other half of the wire vocabulary.
 *
 * The class this belongs to is ANY MODEL-SUPPLIED IDENTIFIER REACHING A
 * RIDER-FACING RENDER, not the component field specifically - the component was
 * simply the first member found. `SYSTEM_PROMPT` now pins `direction` to exact
 * strings too (`soften`, `toe-in`, `shorter gearing`, `reduce negative
 * camber`...), so a recommendation reads `front_rebound · soften` on screen
 * unless both halves are formatted. The lookup answers with the canonical
 * spelling whatever separator arrived, so `toe_in` and `toe-in` both render
 * `Toe-in`, and an unrecognised value passes through unchanged the way a
 * pre-vocabulary row like "Return toward baseline" must.
 *
 * WHAT THE SWEEP COVERED AND WHAT IT DELIBERATELY LEAVES RAW. Method: grep
 * `\.direction|\.magnitude|\.summary|\.reason` across `app`, `components` and
 * `lib` - a render's rows can be built outside the component that prints them,
 * as `buildSetupView` builds the session detail page's - then trace each hit to
 * whether the value is model-supplied or rider-entered.
 *
 * - `direction` is formatted, at the same two sites as the component.
 * - `magnitude` stays raw: "0.5 psi", "1 click" - a quantity with its unit, and
 *   already rider-readable.
 * - `summary` and `reason` stay raw: free model prose, not identifiers.
 * - `confidence` stays raw: a lowercase enum that reads as English in
 *   "Confidence: medium", not identifier-shaped.
 * - `data_used` keys resolve through the `DATA_USED_LABELS` map in
 *   `components/ai/advice-report.tsx`, so they never reach a rider raw.
 * - `suspension.front.direction` in `lib/setup-view.ts` and in the compare rows
 *   of `app/(app)/sessions/[id]/page.tsx` is a FALSE MATCH and must stay
 *   untouched: same field name, but it is the rider's own "in"/"out" entry, not
 *   a model-supplied recommendation.
 */
export function formatDirectionLabel(direction: string): string {
  return DIRECTION_LABELS.get(directionKey(direction)) ?? direction;
}

/**
 * The prompt-facing rendering of the table above. Generated, never hand-copied:
 * this is the text the model is given, and it is built from the same data the
 * policy checks against.
 */
export function describeComponentVocabulary(): string {
  const lines = (Object.entries(COMPONENT_POLICIES) as [ComponentKey, ComponentPolicy][]).map(
    ([key, policy]) =>
      `- ${key}: component must be one of ${policy.aliases.join(', ')}; direction must be one of ${policy.directions.join(', ')}; magnitude in ${policy.unit}, at most ${policy.maxMagnitude} ${policy.unit}.`,
  );
  return [
    'Allowed setup changes. Every entry in `recommended_changes` is checked against this list before the rider sees it, and a recommendation that does not match is discarded entirely - so use these exact strings rather than a paraphrase:',
    ...lines,
    'If the right answer is not expressible here, return an empty `recommended_changes` array and explain in `summary`. Put things to watch rather than change in `prediction.watch_items`, and never write a setup instruction into `summary` or `prediction` - prose is not checked and will be discarded with the whole response.',
  ].join('\n');
}
