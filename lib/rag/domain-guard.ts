import { DISCLAIMER_NOTE, ONE_CHANGE_NOTE } from '@/lib/rag/prompt';
import type { AdviceDataUsed, AdviceResponse } from '@/lib/rag/schema';

export type RaceEngineerRefusalReason =
  | 'out_of_domain'
  | 'prompt_injection'
  | 'no_safe_answer';

export interface RaceEngineerQuestionAssessment {
  decision: 'allow' | 'refuse';
  reason: Exclude<RaceEngineerRefusalReason, 'no_safe_answer'> | null;
  message: string | null;
}

interface ClassifyRaceEngineerQuestionInput {
  question: string;
  symptoms?: string[] | null;
  changeIntent?: string | null;
}

interface BuildRefusalAdviceInput {
  reason: RaceEngineerRefusalReason;
  message: string;
  dataUsed: AdviceDataUsed;
}

interface NormalizeAdviceResponseInput {
  advice: AdviceResponse;
  fallbackDataUsed: AdviceDataUsed;
}

const PROMPT_INJECTION_PATTERNS = [
  /\bignore (?:all |any |the )?(?:previous|prior|earlier) instructions\b/i,
  /\breveal (?:your|the) (?:system prompt|prompt|developer message)\b/i,
  /\bshow (?:your|the) (?:system prompt|prompt|hidden instructions)\b/i,
  /\byou are now\b/i,
  /\bact as\b/i,
  /\broleplay as\b/i,
  /\bjailbreak\b/i,
  /\bdeveloper message\b/i,
  /\bsystem prompt\b/i,
];

const NON_DOMAIN_PATTERNS = [
  /\brecipe\b/i,
  /\bcook(?:ing)?\b/i,
  /\bbak(?:e|ing)\b/i,
  /\bcookies?\b/i,
  /\boatmeal\b/i,
  /\bpoem\b/i,
  /\bjoke\b/i,
  /\btranslate\b/i,
  /\bsummarize\b/i,
  /\bessay\b/i,
  /\bemail\b/i,
  /\bmovie\b/i,
  /\bweather\b/i,
  /\bstock price\b/i,
  /\bjavascript\b/i,
  /\bpython\b/i,
  /\bwrite code\b/i,
];

const MOTORSPORT_PATTERNS = [
  /\bsetup\b/i,
  /\bsession\b/i,
  /\btrack\b/i,
  /\blap\b/i,
  /\btire\b/i,
  /\btyre\b/i,
  /\bpressure\b/i,
  /\bsuspension\b/i,
  /\brebound\b/i,
  /\bcompression\b/i,
  /\bdamping\b/i,
  /\bfork\b/i,
  /\bshock\b/i,
  /\bsag\b/i,
  /\bcamber\b/i,
  /\btoe\b/i,
  /\bcaster\b/i,
  /\bride height\b/i,
  /\bgeometry\b/i,
  /\baero\b/i,
  /\bwing\b/i,
  /\bsplitter\b/i,
  /\bgearing\b/i,
  /\bsprocket\b/i,
  /\bundersteer\b/i,
  /\boversteer\b/i,
  /\bturn[- ]?in\b/i,
  /\bmid[- ]?corner\b/i,
  /\bentry\b/i,
  /\bexit\b/i,
  /\bgrip\b/i,
  /\btraction\b/i,
  /\bbrak(?:e|ing)\b/i,
  /\bchatter\b/i,
  /\bwallow\b/i,
  /\bpacking down\b/i,
  /\bpush(?:es|ing)?\b/i,
  /\bfront\b/i,
  /\brear\b/i,
  /\bchassis\b/i,
];

function countMatches(source: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(source) ? 1 : 0), 0);
}

export function classifyRaceEngineerQuestion(
  input: ClassifyRaceEngineerQuestionInput,
): RaceEngineerQuestionAssessment {
  const combined = [
    input.question,
    ...(input.symptoms ?? []),
    input.changeIntent ?? '',
  ]
    .join(' ')
    .trim();

  if (countMatches(combined, PROMPT_INJECTION_PATTERNS) > 0) {
    return {
      decision: 'refuse',
      reason: 'prompt_injection',
      message:
        'I can only help with track setup questions grounded in this session. Ask what the vehicle did on track and what small setup change to try next.',
    };
  }

  const motorsportSignals = countMatches(combined, MOTORSPORT_PATTERNS);
  const nonDomainSignals = countMatches(combined, NON_DOMAIN_PATTERNS);

  if (motorsportSignals === 0 && nonDomainSignals > 0) {
    return {
      decision: 'refuse',
      reason: 'out_of_domain',
      message:
        'That request is outside track setup scope. Ask about vehicle behavior, tire pressures, chassis balance, or what setup change to try for this session.',
    };
  }

  return {
    decision: 'allow',
    reason: null,
    message: null,
  };
}

export function buildRefusalAdvice(input: BuildRefusalAdviceInput): AdviceResponse {
  const summary =
    input.reason === 'prompt_injection'
      ? 'Race Engineer only answers setup questions about on-track behavior and safe, reversible setup changes.'
      : input.reason === 'out_of_domain'
        ? 'That request is outside the scope of post-session setup advice.'
        : 'I could not identify a safe, supported setup recommendation from that request.';

  return {
    summary,
    recommended_changes: [],
    tradeoffs: [],
    confidence: 'low',
    safety_notes: [DISCLAIMER_NOTE, ONE_CHANGE_NOTE],
    citations: [],
    prediction: {
      expected_effect: 'No setup change is recommended for this request.',
      day_trend: 'No day-trend prediction is available because no setup recommendation was made.',
      watch_items: [],
    },
    personal_evidence: [],
    data_used: input.dataUsed,
    refusal: input.message,
  };
}

export function normalizeAdviceResponse(
  input: NormalizeAdviceResponseInput,
): AdviceResponse {
  const refusal = input.advice.refusal?.trim();
  if (refusal) {
    return buildRefusalAdvice({
      reason: 'no_safe_answer',
      message: refusal,
      dataUsed: input.advice.data_used ?? input.fallbackDataUsed,
    });
  }

  if (input.advice.recommended_changes.length === 0) {
    return buildRefusalAdvice({
      reason: 'no_safe_answer',
      message:
        'I could not identify a safe, supported setup recommendation from that request. Ask about a specific on-track symptom or setup change.',
      dataUsed: input.advice.data_used ?? input.fallbackDataUsed,
    });
  }

  return {
    ...input.advice,
    refusal: null,
  };
}
