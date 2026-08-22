import { DISCLAIMER_NOTE, ONE_CHANGE_NOTE, type RiderTextField } from '@/lib/rag/prompt';
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

interface ClassifyDayPlanRequestInput {
  trackName?: string | null;
  weatherCondition?: string | null;
  surfaceCondition?: string | null;
}

interface ClassifyStoredRiderTextInput {
  fields: RiderTextField[];
}

export interface StoredRiderTextAssessment {
  decision: 'allow' | 'refuse';
  reason: 'prompt_injection' | null;
  message: string | null;
  /** Which field matched, so the refusal can name it. Never the text itself. */
  field: string | null;
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

/**
 * The unambiguous half of the screen: phrases that address the assistant and
 * have no ordinary reading in a rider's description of their own vehicle.
 *
 * Stored text is screened against this set alone. `/\bact as\b/i` is not in it
 * because "the instructor said to act as if the apex is later" is an ordinary
 * session note, and the cost of a false positive is asymmetric: text the rider
 * just typed can be edited in the same breath, while stored text refuses every
 * request deterministically until the rider works out which of their saved
 * fields is to blame.
 */
const STORED_TEXT_INJECTION_PATTERNS = [
  /\bignore (?:all |any |the )?(?:previous|prior|earlier) instructions\b/i,
  /\breveal (?:your|the) (?:system prompt|prompt|developer message)\b/i,
  /\bshow (?:your|the) (?:system prompt|prompt|hidden instructions)\b/i,
  /\byou are now\b/i,
  /\broleplay as\b/i,
  /\bjailbreak\b/i,
  /\bdeveloper message\b/i,
  /\bsystem prompt\b/i,
];

// Text the request just submitted gets the full set, loose patterns included.
const PROMPT_INJECTION_PATTERNS = [...STORED_TEXT_INJECTION_PATTERNS, /\bact as\b/i];

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

const PROMPT_INJECTION_MESSAGE =
  'I can only help with track setup questions grounded in this session. Ask what the vehicle did on track and what small setup change to try next.';

function countMatches(source: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(source) ? 1 : 0), 0);
}

/**
 * The single prompt-injection screen. Both AI entry points read rider-authored
 * text straight into the model prompt, so both run this over that text.
 */
export function hasPromptInjectionSignal(text: string): boolean {
  return countMatches(text, PROMPT_INJECTION_PATTERNS) > 0;
}

export function classifyRaceEngineerQuestion(
  input: ClassifyRaceEngineerQuestionInput,
): RaceEngineerQuestionAssessment {
  const questionText = input.question.trim();
  const supportingText = [
    ...(input.symptoms ?? []),
    input.changeIntent ?? '',
  ]
    .join(' ')
    .trim();

  // Every rider-authored field reaches the model, not just the question:
  // formatMetaBlock in lib/rag/prompt.ts prints symptoms and change intent into
  // the prompt, and sanitizeFreeText neutralises only the <user_data> tag
  // delimiters, not phrases. Screening the question alone left "normal question
  // + change_intent: ignore all previous instructions" walking straight past
  // this guard.
  //
  // Each field is screened on its own rather than as one joined string, so two
  // innocent fields cannot be concatenated into a phrase neither of them
  // contains.
  const injectionCandidates = [
    questionText,
    ...(input.symptoms ?? []),
    input.changeIntent ?? '',
  ];

  if (injectionCandidates.some((value) => value.trim() && hasPromptInjectionSignal(value))) {
    return {
      decision: 'refuse',
      reason: 'prompt_injection',
      message: PROMPT_INJECTION_MESSAGE,
    };
  }

  const questionMotorsportSignals = countMatches(questionText, MOTORSPORT_PATTERNS);
  const questionNonDomainSignals = countMatches(questionText, NON_DOMAIN_PATTERNS);

  // The free-text question is the primary signal for intent. Symptom chips and
  // intent selectors are supporting context only; they must not "rescue" an
  // obviously unrelated question into the setup domain.
  if (questionMotorsportSignals === 0 && questionNonDomainSignals > 0) {
    return {
      decision: 'refuse',
      reason: 'out_of_domain',
      message:
        'That request is outside track setup scope. Ask about vehicle behavior, tire pressures, chassis balance, or what setup change to try for this session.',
    };
  }

  const combinedMotorsportSignals = countMatches(
    [questionText, supportingText].filter(Boolean).join(' '),
    MOTORSPORT_PATTERNS,
  );

  if (combinedMotorsportSignals === 0 && questionNonDomainSignals === 0) {
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

/**
 * The day-plan counterpart of `classifyRaceEngineerQuestion`.
 *
 * It runs the same prompt-injection screen over the only rider-authored text a
 * day-plan request carries - the track name and the two condition strings -
 * because those are interpolated straight into the day-plan prompt.
 *
 * It deliberately does NOT run the out-of-domain arm. That arm reads a
 * free-form question and refuses when nothing in it is about motorsport; a
 * day-plan request has no question, only three short structured fields, so a
 * perfectly ordinary "Laguna Seca / sunny / dry" carries no motorsport token
 * and would be refused as out of domain on every single request. There is also
 * nothing to refuse: the rider cannot ask this endpoint for a cookie recipe,
 * only name a track and describe the weather.
 */
export function classifyDayPlanRequest(
  input: ClassifyDayPlanRequestInput,
): RaceEngineerQuestionAssessment {
  const riderText = [
    input.trackName ?? '',
    input.weatherCondition ?? '',
    input.surfaceCondition ?? '',
  ]
    .join(' ')
    .trim();

  if (riderText && hasPromptInjectionSignal(riderText)) {
    return {
      decision: 'refuse',
      reason: 'prompt_injection',
      message: PROMPT_INJECTION_MESSAGE,
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

/**
 * The second injection screen, over rider text this request did not submit.
 *
 * A day plan interpolates the rider's stored vehicle and recent sessions into
 * the prompt - nickname, make, model, track name, tyre brand and compound,
 * free-text notes. Those were typed on some earlier screen and are just as
 * rider-authored as the question box, but no classifier had ever seen them:
 * `sanitizeFreeText` in `lib/rag/prompt.ts` neutralises the `<user_data>` tag
 * delimiters and nothing else, so a note reading "ignore all previous
 * instructions" reaches the model intact. Injection through data stored earlier
 * is the vector that gets forgotten, because the request that triggers it looks
 * completely ordinary.
 *
 * This necessarily runs after the database read, so it cannot replace the
 * screen on submitted fields - it is the second half of the same guard.
 *
 * It differs from that first screen twice over, and both differences are about
 * the rider rather than the attacker. It uses the narrower pattern set above,
 * and it reports which field matched so the refusal can name it: the rider
 * submitted nothing, so "ask a setup question instead" is advice they cannot
 * act on, and a stored phrase refuses every attempt until it is edited.
 *
 * Each value is screened on its own rather than joined, so a phrase cannot be
 * assembled across the seam between two unrelated fields.
 */
export function classifyStoredRiderText(
  input: ClassifyStoredRiderTextInput,
): StoredRiderTextAssessment {
  for (const field of input.fields) {
    const value = typeof field.value === 'string' ? field.value.trim() : '';
    if (!value) continue;
    if (countMatches(value, STORED_TEXT_INJECTION_PATTERNS) === 0) continue;
    return {
      decision: 'refuse',
      reason: 'prompt_injection',
      // Names the field, never the text: echoing it back would put the phrase
      // on screen and hand an attacker a reflection of their own payload.
      message:
        `I could not build a plan from your saved setup data. The wording in ${field.label} reads as an instruction to me rather than as a description of your vehicle. Edit that field and try again.`,
      field: field.label,
    };
  }

  return { decision: 'allow', reason: null, message: null, field: null };
}
