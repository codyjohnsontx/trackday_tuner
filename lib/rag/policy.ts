import {
  directionAllowed,
  findComponentPolicy,
  magnitudeAllowed,
} from '@/lib/rag/component-vocabulary';
import type { AdviceConfidence, AdviceResponse, RecommendedChange } from '@/lib/rag/schema';
import { buildRefusalAdvice, normalizeAdviceResponse } from '@/lib/rag/domain-guard';

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
 * So an empty plan additionally has to carry no instruction in its summary. Two
 * things bound this check, and both were paid for in false refusals.
 *
 * IT READS `summary` AND NOTHING ELSE. The hole is an instruction sitting where
 * the rider reads it as the plan; `tradeoffs`, `prediction` and
 * `personal_evidence` are read as consequences, forecasts and history, and
 * every false positive this heuristic produced came from scanning them. A
 * warming-day `day_trend` is the shape the day-plan prompt explicitly asks for,
 * so refusing the whole response over it threw away the very answer
 * `allowEmptyRecommendations` exists to preserve.
 *
 * IT MATCHES A DELTA, NOT ANY QUANTITY. What separates an instruction from a
 * report is whether a change verb governs the number: "increase front tire
 * pressure by 6 psi" and "soften front rebound 1 click" are instructions, while
 * "your 30 psi cold baseline" is a reading that happens to share a sentence with
 * a verb. Government is the whole test, and ORDER is what carries it: the verb
 * has to come first and the number second. A bare "by 2 psi" anywhere in the
 * sentence is not enough, because "rear hot pressure came up by 2 psi over cold,
 * and ambient will increase again today" reports one delta and forecasts a
 * separate rise without instructing anything - there the number precedes the
 * verb. Units that describe conditions rather than adjustments (degrees,
 * percent) are not setup units at all and never match.
 *
 * THE UNIT IS A CLAUSE, NOT A SENTENCE. A comma-joined sentence carries more
 * than one intent, and reading it as one let a forecast verb in the first clause
 * govern a reported delta in the second: "grip will drop as the track heats, and
 * hot pressures typically come up by 2 psi from cold" instructs nothing and was
 * refused whole. Splitting at a comma followed by a connective fixed that
 * without touching the rule. A BARE "and" DOES NOT SPLIT, and that boundary is
 * load-bearing: "front and rear cold tire pressure" is one noun phrase, and
 * splitting there stops "Increase the front and rear cold tire pressure by 1
 * psi" being caught at all.
 *
 * A DECIMAL POINT IS NOT A BOUNDARY. The terminator class used to include a bare
 * ".", which tore "by 0.5 psi" into "by 0" and "5 psi" - one piece with the verb
 * and no unit, the other with the unit and no verb - so the instruction escaped.
 * That was the worst possible blind spot to have: the tire-pressure ceiling is
 * 1 psi, so a sub-integer delta is the normal recommendation here and is what
 * both demo fixtures ship. A "." now ends a clause only when it is not sitting
 * between two digits.
 *
 * THE GUARD IS BEST-EFFORT BY DESIGN AND CLOSED TO FURTHER PATTERN WORK. It is
 * deliberately incomplete, and two shapes are KNOWN ACCEPTED GAPS rather than
 * bugs waiting to be fixed:
 *
 * - An instruction carrying no numeric delta. "front tyres want another half
 *   psi" is a real instruction and walks straight past.
 * - Every legal camber recommendation. `SETUP_QUANTITY_SOURCE` omits "degrees"
 *   and "positions" on purpose, so "ambient will climb to 30 degrees" is not
 *   read as a setup change - and because camber's ceiling is 0.5 degrees, that
 *   makes "reduce front camber by 0.5 degrees" invisible here. Adding degrees
 *   would trade this gap for the temperature false positives the omission
 *   exists to prevent.
 *
 * The prompt contract carries the other half, because
 * `describeComponentVocabulary()` tells the model in `SYSTEM_PROMPT` that a
 * setup instruction written into `summary` or `prediction` is not checked and
 * will be discarded with the whole response. Every widening of this pattern has
 * cost a false refusal on a paid route, so a case that escapes from here on is
 * to be RECORDED rather than chased with another pattern change.
 *
 * "set", "sets" and "setting" are deliberately not in the verb list. In a setup
 * logger those words are usually nouns and they sit next to a psi figure
 * constantly, so "start on your baseline 30 psi cold setting and check hot
 * pressures" was refused - which is the baseline-check answer the empty-plan
 * path exists to preserve. Every real instruction verb still trips.
 *
 * The heuristic cannot be complete, and widening it is not the way to make it
 * so: a real recommendation belongs in `recommended_changes` where the
 * magnitude policy can see it, and this only has to stop the summary being used
 * to route around that.
 */
const CHANGE_VERB_SOURCE =
  '(?:increas(?:e|es|ing)|decreas(?:e|es|ing)|rais(?:e|es|ing)|lower(?:s|ing)?|add(?:s|ing)?|drop(?:s|ping)?|bleed(?:s|ing)?|reduc(?:e|es|ing)|soften(?:s|ing)?|stiffen(?:s|ing)?|tighten(?:s|ing)?|loosen(?:s|ing)?|back(?:ing)? off|wind(?:ing)? on|adjust(?:s|ing)?|bump(?:s|ing)?|shim(?:s|ming)?|preload(?:s|ing)?)';

const SETUP_QUANTITY_SOURCE =
  '\\d+(?:\\.\\d+)?\\s*(?:psi|bar|kpa|clicks?|mm|cm|turns?|teeth|tooth|notch(?:es)?)';

const CHANGE_VERB_PATTERN = new RegExp(`\\b${CHANGE_VERB_SOURCE}\\b`, 'i');

// The verb reaches the number two ways, and each covers what the other cannot.
//
// (a) THE DELTA PREPOSITION. A verb, then anything that is not another change
// verb, then "by <quantity>". `by` names the number as a change, so the span in
// between can be any length - which is what "increase THE front tire pressure by
// 1 psi" needs and what a three-word window could never reach. The ordering is
// the government: a number written before the verb is a reading, so "came up by
// 2 psi ... will increase again today" does not match.
//
// (b) THE BARE QUANTITY. A verb within three plain words of a number, for the
// instruction that names no preposition at all ("soften front rebound 1 click").
// Here the reach must be short, because without `by` nothing marks the number as
// a change; a possessive, a clause connective or any punctuation ends it, since
// past one of those the number belongs to a different phrase.
const GOVERNMENT_BREAKERS =
  'your|my|our|their|its|his|her|so|and|but|because|while|although|though|through|when|if|after|before|than|that|which|to|at|for|from|with';

const DELTA_QUANTITY_PATTERN = new RegExp(
  `\\b${CHANGE_VERB_SOURCE}\\b(?:(?!\\b${CHANGE_VERB_SOURCE}\\b)[\\s\\S])*?\\bby\\s+${SETUP_QUANTITY_SOURCE}\\b` +
    `|\\b${CHANGE_VERB_SOURCE}\\s+(?:(?!(?:${GOVERNMENT_BREAKERS})\\b)[a-z]+\\s+){0,3}${SETUP_QUANTITY_SOURCE}\\b`,
  'i',
);

const CLAUSE_BOUNDARY_PATTERN =
  /(?:[!?;\n]+|(?<!\d)\.(?!\d))+|,\s*(?:and|but|so|then|while|whereas|although|though|yet)\b/i;

function hasActionableProse(advice: AdviceResponse): boolean {
  const summary = typeof advice.summary === 'string' ? advice.summary : '';
  return summary
    .split(CLAUSE_BOUNDARY_PATTERN)
    .some(
      (clause) => CHANGE_VERB_PATTERN.test(clause) && DELTA_QUANTITY_PATTERN.test(clause),
    );
}

function changeViolations(change: RecommendedChange): AdvicePolicyViolation[] {
  const policy = findComponentPolicy(change.component);
  if (!policy) return ['unknown_component'];

  const violations: AdvicePolicyViolation[] = [];
  if (!directionAllowed(policy, change.direction)) {
    violations.push('unsupported_direction');
  }
  if (!magnitudeAllowed(policy, change.magnitude)) {
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
            'That plan described a setup change in prose without proposing it as a checked recommendation, so I am not returning it. Try building the plan again, or review the conditions you entered for this day.',
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
