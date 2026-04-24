import type { AdviceConfidence, AdviceResponse, RecommendedChange } from '@/lib/rag/schema';
import { buildRefusalAdvice } from '@/lib/rag/domain-guard';

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
  | 'unknown_component'
  | 'unsupported_direction'
  | 'unsafe_magnitude'
  | 'ungrounded_recommendation'
  | 'high_confidence_without_support';

export interface AdvicePolicyEvaluation {
  decision: AdvicePolicyDecision;
  violations: AdvicePolicyViolation[];
  advice: AdviceResponse;
}

interface AdvicePolicyInput {
  advice: AdviceResponse;
  fallbackDataUsed: AdviceResponse['data_used'];
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
    validateMagnitude: (value) => /\bdegree\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 0.5,
  },
  sprocket: {
    aliases: ['rear_sprocket', 'front_sprocket', 'rear sprocket', 'front sprocket'],
    directionPatterns: [/\bshorter gearing\b/i, /\btaller gearing\b/i, /\bincrease\b/i, /\bdecrease\b/i],
    validateMagnitude: (value) => /\btooth\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 2,
  },
  wing_angle: {
    aliases: ['rear_wing_angle', 'front_wing_angle', 'rear wing angle', 'front wing angle'],
    directionPatterns: [/\bincrease\b/i, /\bdecrease\b/i],
    validateMagnitude: (value) => /\bposition\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 2,
  },
  geometry: {
    aliases: ['fork_height', 'rear_ride_height', 'fork height', 'rear ride height'],
    directionPatterns: [/\bincrease\b/i, /\bdecrease\b/i, /\braise\b/i, /\blower\b/i],
    validateMagnitude: (value) => /\bmm\b/i.test(value) && (parseRangeMax(value) ?? Infinity) <= 3,
  },
};

function findComponentPolicy(component: string): ComponentPolicy | null {
  const normalized = component.trim().toLowerCase();
  for (const policy of Object.values(COMPONENT_POLICIES)) {
    if (policy.aliases.includes(normalized)) return policy;
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

function grounded(advice: AdviceResponse): boolean {
  return advice.citations.length > 0 || advice.personal_evidence.length > 0;
}

function supportedHighConfidence(advice: AdviceResponse): boolean {
  if (advice.confidence !== 'high') return true;
  return advice.citations.length > 0 && (advice.personal_evidence.length > 0 || advice.data_used.history || advice.data_used.feedback || advice.data_used.telemetry);
}

function downgradeConfidence(confidence: AdviceConfidence): AdviceConfidence {
  if (confidence === 'high') return 'medium';
  return 'low';
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

  if (advice.recommended_changes.length === 0) {
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

  if (!grounded(advice)) {
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

  if (!supportedHighConfidence(advice)) {
    return {
      decision: 'downgrade_confidence',
      violations: ['high_confidence_without_support'],
      advice: {
        ...advice,
        confidence: downgradeConfidence(advice.confidence),
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
