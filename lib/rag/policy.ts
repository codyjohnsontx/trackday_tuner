import type { AdviceConfidence, AdviceResponse, RecommendedChange } from '@/lib/rag/schema';
import { buildRefusalAdvice, normalizeAdviceResponse } from '@/lib/rag/domain-guard';

type ComponentKey =
  | 'tire_pressure'
  | 'toe'
  | 'rebound'
  | 'compression'
  | 'camber'
  | 'sprocket'
  | 'wing_angle'
  | 'geometry';

type AdvicePolicyDecision = 'allow' | 'force_refusal' | 'downgrade_confidence';

export type AdvicePolicyViolation =
  | 'refusal_with_changes'
  | 'no_recommendation'
  | 'invalid_personal_evidence'
  | 'unknown_component'
  | 'unsupported_direction'
  | 'unsafe_magnitude'
  | 'ungrounded_recommendation'
  | 'high_confidence_without_support'
  | 'actionable_prose_without_changes';

export interface AdvicePolicyEvaluation {
  decision: AdvicePolicyDecision;
  violations: AdvicePolicyViolation[];
  advice: AdviceResponse;
}

interface AdvicePolicyInput {
  advice: AdviceResponse;
  fallbackDataUsed: AdviceResponse['data_used'];
  validSessionIds?: string[];
  /**
   * Post-session advice that recommends nothing is a non-answer, so the default
   * is to force a refusal. A morning day plan is different: the day-plan prompt
   * explicitly tells the model that `recommended_changes` may be empty when the
   * right plan is to establish baseline checks first, and refusing that would
   * throw away a correct answer. Every other check still runs.
   */
  allowEmptyRecommendations?: boolean;
}

/**
 * A setup instruction is only checked when it arrives in `recommended_changes`,
 * where the component, direction and magnitude are validated individually. When
 * the empty-plan path is open, a model that puts the instruction in the summary
 * instead would walk straight past that check and the rider would read unvetted
 * advice - the structured field is guarded while the prose field, which is what
 * they actually read, is not.
 *
 * So an empty plan additionally has to be non-actionable. This is a deliberate
 * heuristic and deliberately conservative: a change verb and a setup quantity in
 * the same sentence is treated as an instruction and refused. The correct place
 * for a real recommendation is `recommended_changes`, where the magnitude policy
 * can see it; monitoring belongs in `prediction.watch_items`, which carries no
 * instruction. Units that describe conditions rather than adjustments (degrees,
 * percent) are excluded so an ordinary "expect track temp to climb" summary is
 * not mistaken for a setup change.
 */
const CHANGE_VERB_PATTERN =
  /\b(?:increas(?:e|es|ing)|decreas(?:e|es|ing)|rais(?:e|es|ing)|lower(?:s|ing)?|add(?:s|ing)?|drop(?:s|ping)?|bleed(?:s|ing)?|reduc(?:e|es|ing)|soften(?:s|ing)?|stiffen(?:s|ing)?|tighten(?:s|ing)?|loosen(?:s|ing)?|back(?:ing)? off|wind(?:ing)? on|set(?:s|ting)?|adjust(?:s|ing)?|bump(?:s|ing)?|shim(?:s|ming)?|preload(?:s|ing)?)\b/i;

const SETUP_QUANTITY_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:psi|bar|kpa|clicks?|mm|cm|turns?|teeth|tooth|notch(?:es)?)\b/i;

function proseFields(advice: AdviceResponse): string[] {
  return [
    advice.summary,
    ...advice.tradeoffs,
    advice.prediction?.expected_effect ?? '',
    advice.prediction?.day_trend ?? '',
    ...(advice.prediction?.watch_items ?? []),
    ...advice.personal_evidence.map((entry) => entry.detail),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function hasActionableProse(advice: AdviceResponse): boolean {
  return proseFields(advice).some((field) =>
    field
      .split(/[.!?;\n]+/)
      .some(
        (sentence) =>
          CHANGE_VERB_PATTERN.test(sentence) && SETUP_QUANTITY_PATTERN.test(sentence),
      ),
  );
}

interface ComponentPolicy {
  aliases: string[];
  directionPatterns: RegExp[];
  validateMagnitude: (value: string) => boolean;
}

function parseRangeMax(value: string): number | null {
  const matches = [...value.matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (matches.length === 0 || matches.some((entry) => !Number.isFinite(entry))) return null;
  return Math.max(...matches.map((entry) => Math.abs(entry)));
}

const COMPONENT_POLICIES: Record<ComponentKey, ComponentPolicy> = {
  tire_pressure: {
    aliases: [
      'front_tire_pressure',
      'rear_tire_pressure',
      'front_and_rear_cold_pressure',
      'front tire pressure',
      'rear tire pressure',
      'front and rear cold pressure',
    ],
    directionPatterns: [/\bincrease\b/i, /\bdecrease\b/i, /\braise\b/i, /\blower\b/i],
    validateMagnitude: (value) => /\bpsi\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 1,
  },
  toe: {
    aliases: ['front_toe', 'rear_toe', 'front toe', 'rear toe'],
    directionPatterns: [/\btoe-in\b/i, /\btoe-out\b/i, /\bincrease\b/i, /\bdecrease\b/i],
    validateMagnitude: (value) => /\bmm\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 3,
  },
  rebound: {
    aliases: ['front_rebound', 'rear_rebound', 'front rebound', 'rear rebound'],
    directionPatterns: [/\bstiffen\b/i, /\bsoften\b/i, /\bincrease\b/i, /\bdecrease\b/i],
    validateMagnitude: (value) => /\bclicks?\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 2,
  },
  compression: {
    aliases: ['front_compression', 'rear_compression', 'front compression', 'rear compression'],
    directionPatterns: [/\bstiffen\b/i, /\bsoften\b/i, /\bincrease\b/i, /\bdecrease\b/i],
    validateMagnitude: (value) => /\bclicks?\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 2,
  },
  camber: {
    aliases: ['front_camber', 'rear_camber', 'front camber', 'rear camber'],
    directionPatterns: [
      /\bincrease\b/i,
      /\bdecrease\b/i,
      /\breduce negative camber\b/i,
      /\bincrease negative camber\b/i,
    ],
    validateMagnitude: (value) => /\bdegrees?\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 0.5,
  },
  sprocket: {
    aliases: ['rear_sprocket', 'front_sprocket', 'rear sprocket', 'front sprocket'],
    directionPatterns: [/\bshorter gearing\b/i, /\btaller gearing\b/i, /\bincrease\b/i, /\bdecrease\b/i],
    validateMagnitude: (value) => /\b(?:tooth|teeth)\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 2,
  },
  wing_angle: {
    aliases: ['rear_wing_angle', 'front_wing_angle', 'rear wing angle', 'front wing angle'],
    directionPatterns: [/\bincrease\b/i, /\bdecrease\b/i],
    validateMagnitude: (value) => /\bpositions?\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 2,
  },
  geometry: {
    aliases: ['fork_height', 'rear_ride_height', 'fork height', 'rear ride height'],
    directionPatterns: [/\bincrease\b/i, /\bdecrease\b/i, /\braise\b/i, /\blower\b/i],
    validateMagnitude: (value) => /\bmm\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 3,
  },
};

function findComponentPolicy(component: string): ComponentPolicy | null {
  const normalized = component.trim().toLowerCase();
  for (const [key, policy] of Object.entries(COMPONENT_POLICIES) as [ComponentKey, ComponentPolicy][]) {
    if (key === normalized || policy.aliases.includes(normalized)) return policy;
  }
  return null;
}

function changeViolations(change: RecommendedChange): AdvicePolicyViolation[] {
  const policy = findComponentPolicy(change.component);
  if (!policy) return ['unknown_component'];

  const violations: AdvicePolicyViolation[] = [];
  if (!policy.directionPatterns.some((pattern) => pattern.test(change.direction))) {
    violations.push('unsupported_direction');
  }
  if (!policy.validateMagnitude(change.magnitude)) {
    violations.push('unsafe_magnitude');
  }
  return violations;
}

function validSessionIdSet(validSessionIds: string[] | undefined): Set<string> {
  return new Set((validSessionIds ?? []).filter(Boolean));
}

function hasVerifiedPersonalEvidence(
  advice: AdviceResponse,
  validSessionIds: string[] | undefined,
): boolean {
  const allowed = validSessionIdSet(validSessionIds);
  if (allowed.size === 0) return false;
  return advice.personal_evidence.some(
    (entry) => entry.source_session_id != null && allowed.has(entry.source_session_id),
  );
}

function hasInvalidPersonalEvidence(
  advice: AdviceResponse,
  validSessionIds: string[] | undefined,
): boolean {
  const allowed = validSessionIdSet(validSessionIds);
  if (allowed.size === 0) {
    return advice.personal_evidence.some((entry) => entry.source_session_id != null);
  }
  return advice.personal_evidence.some(
    (entry) => entry.source_session_id != null && !allowed.has(entry.source_session_id),
  );
}

function grounded(
  advice: AdviceResponse,
  validSessionIds: string[] | undefined,
): boolean {
  return advice.citations.length > 0 || hasVerifiedPersonalEvidence(advice, validSessionIds);
}

function hasSupportForHighConfidence(
  advice: AdviceResponse,
  validSessionIds: string[] | undefined,
): boolean {
  return (
    advice.citations.length > 0 &&
    (hasVerifiedPersonalEvidence(advice, validSessionIds) ||
      advice.data_used.history ||
      advice.data_used.feedback ||
      advice.data_used.lap_data ||
      advice.data_used.telemetry)
  );
}

function supportedHighConfidence(
  advice: AdviceResponse,
  validSessionIds: string[] | undefined,
): boolean {
  if (advice.confidence !== 'high') return true;
  return hasSupportForHighConfidence(advice, validSessionIds);
}

function downgradeConfidence(): AdviceConfidence {
  return 'medium';
}

export function evaluateAdvicePolicy(input: AdvicePolicyInput): AdvicePolicyEvaluation {
  const advice = {
    ...input.advice,
    data_used: input.advice.data_used ?? input.fallbackDataUsed,
  };

  const refusal = advice.refusal?.trim();
  if (refusal && advice.recommended_changes.length > 0) {
    return {
      decision: 'force_refusal',
      violations: ['refusal_with_changes'],
      advice: buildRefusalAdvice({
        reason: 'no_safe_answer',
        message: refusal,
        dataUsed: advice.data_used,
      }),
    };
  }

  if (refusal && advice.recommended_changes.length === 0) {
    return {
      decision: 'force_refusal',
      violations: ['no_recommendation'],
      advice: normalizeAdviceResponse({
        advice: {
          ...advice,
          refusal,
        },
        fallbackDataUsed: advice.data_used,
      }),
    };
  }

  if (advice.recommended_changes.length === 0 && input.allowEmptyRecommendations) {
    // The empty-plan path is only safe while the prose carries no instruction.
    if (hasActionableProse(advice)) {
      return {
        decision: 'force_refusal',
        violations: ['actionable_prose_without_changes'],
        advice: buildRefusalAdvice({
          reason: 'no_safe_answer',
          message:
            'That plan described a setup change in prose without proposing it as a checked recommendation, so I am not returning it. Ask for a specific change and I will keep it conservative.',
          dataUsed: advice.data_used,
        }),
      };
    }
  }

  if (advice.recommended_changes.length === 0 && !input.allowEmptyRecommendations) {
    return {
      decision: 'force_refusal',
      violations: ['no_recommendation'],
      advice: buildRefusalAdvice({
        reason: 'no_safe_answer',
        message:
          'I could not identify a safe, supported setup recommendation from that request. Ask about a specific on-track symptom or setup change.',
        dataUsed: advice.data_used,
      }),
    };
  }

  if (hasInvalidPersonalEvidence(advice, input.validSessionIds)) {
    return {
      decision: 'force_refusal',
      violations: ['invalid_personal_evidence'],
      advice: buildRefusalAdvice({
        reason: 'no_safe_answer',
        message:
          'I could not verify the historical session evidence referenced in that response, so I am not returning a setup recommendation.',
        dataUsed: advice.data_used,
      }),
    };
  }

  const violations = advice.recommended_changes.flatMap(changeViolations);
  if (violations.length > 0) {
    return {
      decision: 'force_refusal',
      violations,
      advice: buildRefusalAdvice({
        reason: 'no_safe_answer',
        message:
          'I could not verify a safe, supported setup change from that response. Ask about one on-track symptom and I will keep the recommendation conservative.',
        dataUsed: advice.data_used,
      }),
    };
  }

  if (!grounded(advice, input.validSessionIds)) {
    return {
      decision: 'force_refusal',
      violations: ['ungrounded_recommendation'],
      advice: buildRefusalAdvice({
        reason: 'no_safe_answer',
        message:
          'I do not have enough grounded support in your session data or knowledge base to make a safe setup recommendation here.',
        dataUsed: advice.data_used,
      }),
    };
  }

  if (!supportedHighConfidence(advice, input.validSessionIds)) {
    return {
      decision: 'downgrade_confidence',
      violations: ['high_confidence_without_support'],
      advice: {
        ...advice,
        confidence: downgradeConfidence(),
      },
    };
  }

  return {
    decision: 'allow',
    violations: [],
    advice: {
      ...advice,
      refusal: null,
    },
  };
}
