import { createHmac } from 'node:crypto';

const MAX_PREVIEW_LENGTH = 140;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForFingerprint(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

/**
 * Which rules `redactForStorage` applies, stamped on every `ai_request_text`
 * row as `redaction_version` so a replay set can tell rows masked under
 * different rules apart. Bump it whenever a pattern below changes what it masks.
 */
export const REDACTION_VERSION = 1;

// A link with no scheme: `www.` anything, or a host name ending in one of the
// top-level domains a rider is likely to paste. A list rather than any
// two-letter ending, because a missing space after a full stop
// ("rebound.Then") is ordinary prose and must not read as a link.
const SCHEMELESS_LINK =
  /\bwww\.\S+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|uk|ca|au|de|app|dev|info|ly|gg|tv|xyz)\b(?:\/\S*)?/gi;

// Phone numbers, in the shapes that cannot be setup data. None may touch a
// digit, letter, colon or decimal point on either side, so a lap time
// (1:23.456) or a pressure (32.5) never starts or ends one.
//   - `+` and a country code, then digit groups: 8 to 15 digits in all.
//   - A bracketed area code, then groups of 3 or 4 and exactly 4 digits
//     ((555) 123-4567, (020) 7946 0958).
//   - Exactly 3, 3 and 4 digits (555 123 4567). Riders list readings as
//     numbers of one size - tyre temperatures 180 185 175, spring rates
//     95 105 110, shift points 8500 9000 9500 - and a looser grouping masks
//     those.
//   - A trunk prefix: a first group starting with 0, then two groups of 3 or 4
//     digits (020 7946 0958, 07700 900 123, 0412 345 678). A 24-hour session
//     time starts with 0 too, so three 4-digit groups that are all valid
//     times (0900 1030 1200) are a schedule and are left alone.
// A date always has a two-digit group, so it is never one.
// A bare 7-digit local number (555-1234) is deliberately not matched: it is the
// shape of an rpm range (900-1100 is short of it, but 500-1500 is not), and an
// unseparated run of six or more digits is masked as a long number anyway.
const PHONE_EDGE_BEFORE = String.raw`(?<![\w:.+])`;
const PHONE_EDGE_AFTER = String.raw`(?![\w]|[:.]\d)`;
const INTERNATIONAL_PHONE = new RegExp(
  String.raw`${PHONE_EDGE_BEFORE}\+\d{1,3}(?:[\s.-]?\(\d{1,4}\))?(?:[\s.-]?\d{1,4}){1,6}${PHONE_EDGE_AFTER}`,
  'g',
);
const GROUPED_PHONE = new RegExp(
  String.raw`${PHONE_EDGE_BEFORE}(?:\(\d{2,5}\)[\s.-]?\d{3,4}[\s.-]\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4}|0\d{1,4}[\s.-]\d{3,4}[\s.-]\d{3,4})${PHONE_EDGE_AFTER}`,
  'g',
);

function countDigits(value: string): number {
  return value.replace(/\D/g, '').length;
}

function isClockTimeList(value: string): boolean {
  const groups = value.split(/\D+/).filter(Boolean);
  return groups.length === 3 && groups.every((group) => /^(?:[01]\d|2[0-3])[0-5]\d$/.test(group));
}

/**
 * Masks the tokens a rider's AI request text must never be stored with: web
 * links, email addresses, UUIDs, phone numbers and runs of six or more digits.
 *
 * It is the one definition of that for BOTH stored copies - the full text in
 * `ai_request_text` and the 140-character `ai_requests.prompt_redacted_preview`
 * - because the privacy notice promises what is masked in one sentence, and two
 * helpers would let one copy keep what the other hides. It does not collapse
 * whitespace or truncate; the preview does that around it.
 *
 * When a string could be either, privacy wins over replay fidelity and it is
 * masked; what is plainly not a phone number, a link or an address is not.
 *
 * Order matters. A scheme link goes first so an address inside one is masked as
 * a link; an email goes before a schemeless link, or its domain would be eaten
 * as one and leave `rider@[url]`; a UUID and a phone number go before the long
 * number rule, which would otherwise take pieces of both.
 *
 * Names, street addresses and anything else that needs an entity recogniser
 * are not masked, and the notice does not claim they are.
 */
export function redactForStorage(value: string): string {
  return value
    .replace(/\bhttps?:\/\/\S+/gi, '[url]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(SCHEMELESS_LINK, '[url]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(INTERNATIONAL_PHONE, (match) => {
      const digits = countDigits(match);
      return digits >= 8 && digits <= 15 ? '[phone]' : match;
    })
    .replace(GROUPED_PHONE, (match) => (isClockTimeList(match) ? match : '[phone]'))
    .replace(/\b\d{6,}\b/g, '[number]');
}

function truncatePreview(value: string): string {
  if (value.length <= MAX_PREVIEW_LENGTH) return value;
  const shortened = value.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd();
  return `${shortened}…`;
}

export function buildPromptFingerprint(params: {
  question: string;
  symptoms?: string[] | null;
  changeIntent?: string | null;
  secret: string;
}): string {
  const normalized = normalizeForFingerprint(
    [
      params.question,
      ...(params.symptoms ?? []),
      params.changeIntent ?? '',
    ]
      .filter(Boolean)
      .join(' | '),
  );
  return createHmac('sha256', params.secret).update(normalized).digest('hex');
}

export function buildPromptRedactedPreview(question: string): string {
  const normalized = collapseWhitespace(question);
  const redacted = redactForStorage(normalized);
  return truncatePreview(redacted);
}
