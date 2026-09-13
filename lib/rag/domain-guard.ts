import {
  DISCLAIMER_NOTE,
  ONE_CHANGE_NOTE,
  skippableSourceKey,
  type RiderTextField,
  type SkippableSource,
} from '@/lib/rag/prompt';
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
  /**
   * The refusal's opening sentence, which is the one route-specific part of it.
   * "I could not build a plan" is nonsense on a route the rider asked a question
   * of. The sentence that names the field is NOT a parameter, because "name it,
   * never echo it" is the security decision and belongs in one place.
   */
  unableMessage: string;
}

export interface StoredRiderTextAssessment {
  decision: 'allow' | 'refuse';
  reason: 'prompt_injection' | null;
  message: string | null;
  /** Which field matched, so the refusal can name it. Never the text itself. */
  field: string | null;
  /**
   * The sources of the skip-disposed fields that matched. The caller MUST drop
   * these from the prompt before the model call - an allow that leaves them in
   * is worse than the refusal it replaced, because the value is then neither
   * screened nor withheld. `dropScreenedSources` is what acts on them. Empty on
   * a refusal: nothing reaches the model.
   */
  droppedSources: SkippableSource[];
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
 * "you are now", narrowed to a ROLE REASSIGNMENT.
 *
 * The bare `/\byou are now\b/i` is ordinary English and it was the entire
 * stored-text lockout class: "you are now getting on the gas earlier" is a
 * completely normal track note, and once written into a saved session it refused
 * every subsequent request that read it. The semantic difference this encodes is
 * that an INJECTION REASSIGNS AN IDENTITY while a RIDING NOTE DESCRIBES A
 * BEHAVIOUR, so the phrase only fires when a role-identity token or a
 * rule-negation phrase follows it within a short window.
 *
 * TOKENS DELIBERATELY LEFT OUT, each one measured against real riding prose
 * before removal, and each removal re-checked against the injection corpus so it
 * cost no detection. Do not re-add them without repeating that:
 * - bare `dan`          - riders are called Dan ("you are now on Dan's line
 *                         through turn 3"). The DAN payload still lands via
 *                         `do anything now`.
 * - `character`         - "you are now a character on the podium".
 * - `rules?` in the without-branch - "you are now comfortable without rules
 *                         about tyre warmers".
 * - `limits?` likewise  - "you are now smoother without limits on entry speed".
 * - `model`, `system`   - "you are now on the new model bike", "you are now
 *                         trusting the system more". `system prompt` and
 *                         `developer message` keep their own patterns in the
 *                         set below.
 *
 * WHY A WEAKER PATTERN IS DEFENSIBLE HERE, which is the part that stops this
 * reading as somebody loosening a security check. A lexical list is
 * enumerable-around and the corpus behind it is not exhaustive, so this IS
 * strictly weaker than the bare phrase against a determined attacker. It is
 * acceptable because for STORED text the attacker and the victim are the same
 * person: every row reaching these prompts is RLS-scoped to the requesting
 * rider, and there is no shared, imported or third-party write path, so working
 * around this manipulates only your own advice. `evaluateAdvicePolicy` then
 * still force-refuses unless the result names a vocabulary component and
 * direction, a magnitude under its ceiling, a retrieved citation and real
 * session ids. Submitted text keeps the bare phrase below, where a refusal is
 * always actionable and costs the rider nothing but a retype.
 *
 * `tests/../domain-guard.test.ts` carries the whole corpus as permanent
 * regression cases, labelled by which direction each one defends.
 */
const ROLE_REASSIGNMENT_PATTERN =
  /\byou are now\b[^.!?]{0,40}?(?:\b(?:assistant|chatbot|language model|llm|ai|persona|jailbroken|unrestricted|unfiltered|uncensored|roleplaying)\b|\b(?:no longer|not) bound\b|\bwithout (?:restrictions?|filters?)\b|\bdo anything now\b|\bacting as\b|\bfree to ignore\b)/i;

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
  ROLE_REASSIGNMENT_PATTERN,
  /\broleplay as\b/i,
  /\bjailbreak\b/i,
  /\bdeveloper message\b/i,
  /\bsystem prompt\b/i,
];

// Text the request just submitted gets the full set, loose patterns included -
// including the BARE "you are now" that stored text no longer uses. The lockout
// argument that justified narrowing does not apply on this side: a rider can
// edit what they just typed, so a false positive costs one retype rather than
// refusing the same request forever.
const PROMPT_INJECTION_PATTERNS = [
  ...STORED_TEXT_INJECTION_PATTERNS,
  /\bact as\b/i,
  /\byou are now\b/i,
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

/**
 * One word of the setup vocabulary per entry, WITH ITS OWN INFLECTIONS AND
 * NOTHING ELSE. "The fronts overheat after three laps and hot pressures run over
 * target" is the same question as its singular rewrite, but while every entry
 * here was a `\b`-anchored singular it scored zero signals and was refused as
 * out of domain.
 *
 * A noun takes its plural. A word riders also use as a verb for what the vehicle
 * did, or what they did on it, takes -s, -ed and -ing as well. An inflection is
 * left out when ordinary English almost always means a different sense by it -
 * `tired`, `pressured`, `shocked`, `tracking` - because admitting those would
 * widen what counts as motorsport rather than match how riders write. Adding a
 * new word is a different change from inflecting one already here, and
 * `domain-guard.test.ts` pins both halves.
 */
const MOTORSPORT_PATTERNS = [
  /\bsetups?\b/i,
  /\bsessions?\b/i,
  /\btracks?\b/i,
  /\blap(?:s|ped|ping)?\b/i,
  /\btires?\b/i,
  /\btyres?\b/i,
  /\bpressures?\b/i,
  /\bsuspensions?\b/i,
  /\brebound(?:s|ed|ing)?\b/i,
  /\bcompressions?\b/i,
  /\bdamping\b/i,
  /\bforks?\b/i,
  /\bshocks?\b/i,
  /\bsag(?:s|ged|ging)?\b/i,
  /\bcambers?\b/i,
  /\btoe(?:s|d|ing)?\b/i,
  /\bcasters?\b/i,
  /\bride heights?\b/i,
  /\bgeometr(?:y|ies)\b/i,
  /\baero\b/i,
  /\bwings?\b/i,
  /\bsplitters?\b/i,
  /\bgearing\b/i,
  /\bsprockets?\b/i,
  /\bundersteer(?:s|ed|ing)?\b/i,
  /\boversteer(?:s|ed|ing)?\b/i,
  /\bturn(?:s|ed|ing)?[- ]?ins?\b/i,
  /\bmid[- ]?corners?\b/i,
  /\bentr(?:y|ies)\b/i,
  /\bexit(?:s|ed|ing)?\b/i,
  /\bgrip(?:s|ped|ping)?\b/i,
  /\btraction\b/i,
  /\bbrak(?:es?|ed|ing)\b/i,
  /\bchatter(?:s|ed|ing)?\b/i,
  /\bwallow(?:s|ed|ing)?\b/i,
  /\bpack(?:s|ed|ing)? down\b/i,
  /\bpush(?:es|ed|ing)?\b/i,
  /\bfronts?\b/i,
  /\brears?\b/i,
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

  // THIS ARM IS INERT FOR THE PANEL'S CHIPS. The ids it posts -
  // `understeer_mid`, `reduce_tire_wear` - are joined by `_`, which is a word
  // character, so no `\b`-anchored pattern above matches inside one and no chip
  // ever adds a signal here. Every chip combination the route accepts, with
  // questions of every kind, was run through this function and none changed a
  // classification. Free text in these fields still can: the route accepts any
  // short string, so a request carrying "Understeer on entry" as a symptom
  // rescues a question with no signal of its own.
  //
  // Whether a chip SHOULD be able to rescue such a question is an open product
  // decision. Teaching the patterns to read ids would decide it one way and
  // deleting this arm would decide it the other, so it is left as it is until
  // that decision is made.
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
 *
 * Each field is screened on its own rather than as one joined string, as in the
 * other two screeners. Joining them lets a phrase be assembled across the seam:
 * a track named "you are" beside a weather condition of "now sunny" reads as
 * "you are now sunny" once concatenated, and refuses a paid request over a
 * phrase neither field contains.
 */
export function classifyDayPlanRequest(
  input: ClassifyDayPlanRequestInput,
): RaceEngineerQuestionAssessment {
  const injectionCandidates = [
    input.trackName ?? '',
    input.weatherCondition ?? '',
    input.surfaceCondition ?? '',
  ];

  if (injectionCandidates.some((value) => value.trim() && hasPromptInjectionSignal(value))) {
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
 * Both AI prompts interpolate the rider's stored vehicle and sessions into the
 * model call - nickname, make, model, track name, tyre brand and compound,
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
 * Which is also why a match does not always refuse. REFUSE when the rider can
 * go and fix the field; SKIP when they cannot reach it, whoever typed it -
 * `RiderTextField.onMatch` carries that decision from the collector, which is
 * the only place the field's provenance is known, and `RiderTextField` explains
 * the axis. A refuse-disposed match wins over any number of skips, because
 * skipping a field the rider could have edited would turn this guard into a
 * silent hole, which is worse than the trap the skip exists to end.
 *
 * Each value is screened on its own rather than joined, so a phrase cannot be
 * assembled across the seam between two unrelated fields.
 *
 * BOTH live routes call this, each with its own collector: `/api/ai/day-plan`
 * with `collectDayPlanRiderText` and `/api/ai/tuning-advice` with
 * `collectTuningAdviceRiderText`. The collectors are separate on purpose and a
 * call added here would not be the fix for a third route - the whole point is
 * that the field list is derived from the prompt builder's own input type, so
 * a route screens exactly what its own prompt interpolates. Tuning-advice went
 * a full release screening none of it while day-plan screened all of it,
 * because a guard wired to one of two twins reads as covering both.
 */
export function classifyStoredRiderText(
  input: ClassifyStoredRiderTextInput,
): StoredRiderTextAssessment {
  const droppedSources: SkippableSource[] = [];
  const seenSources = new Set<string>();

  for (const field of input.fields) {
    const value = typeof field.value === 'string' ? field.value.trim() : '';
    if (!value) continue;
    if (countMatches(value, STORED_TEXT_INJECTION_PATTERNS) === 0) continue;
    if (field.onMatch === 'skip') {
      const key = skippableSourceKey(field.source);
      if (!seenSources.has(key)) {
        seenSources.add(key);
        droppedSources.push(field.source);
      }
      continue;
    }
    return {
      decision: 'refuse',
      reason: 'prompt_injection',
      // Names the field, never the text: echoing it back would put the phrase
      // on screen and hand an attacker a reflection of their own payload.
      message:
        `${input.unableMessage} The wording in ${field.label} reads as an instruction to me rather than as a description of your vehicle. Edit that field and try again.`,
      field: field.label,
      droppedSources: [],
    };
  }

  return { decision: 'allow', reason: null, message: null, field: null, droppedSources };
}
