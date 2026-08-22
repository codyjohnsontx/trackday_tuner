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

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function directionAllowed(policy: ComponentPolicy, direction: string): boolean {
  return policy.directions.some((allowed) =>
    new RegExp(`\\b${escapeForPattern(allowed)}\\b`, 'i').test(direction),
  );
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
 * Anything this table does not recognise is returned unchanged. The policy
 * refuses unknown components before they can reach a panel, so a string that
 * gets this far is either canonical or something no rule here should be
 * reshaping.
 */
export function formatComponentLabel(component: string): string {
  if (!findComponentPolicy(component)) return component;
  const spaced = component.trim().toLowerCase().replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
