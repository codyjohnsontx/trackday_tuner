import { createHmac } from 'node:crypto';

const MAX_PREVIEW_LENGTH = 140;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForFingerprint(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

function redactSensitiveTokens(value: string): string {
  return value
    .replace(/\bhttps?:\/\/\S+/gi, '[url]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[id]')
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
  const redacted = redactSensitiveTokens(normalized);
  return truncatePreview(redacted);
}
