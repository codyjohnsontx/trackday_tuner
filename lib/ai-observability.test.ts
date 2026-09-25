import { describe, expect, it } from 'vitest';
import {
  buildPromptFingerprint,
  buildPromptRedactedPreview,
  redactForStorage,
} from '@/lib/ai-observability';

const TEST_SECRET = 'test-observability-secret';

describe('buildPromptFingerprint', () => {
  it('is stable across casing and repeated whitespace', () => {
    const a = buildPromptFingerprint({
      question: ' Front pushes on entry ',
      symptoms: ['understeer_entry'],
      changeIntent: 'sharper_turn_in',
      secret: TEST_SECRET,
    });
    const b = buildPromptFingerprint({
      question: 'front pushes   on entry',
      symptoms: ['understeer_entry'],
      changeIntent: 'sharper_turn_in',
      secret: TEST_SECRET,
    });
    expect(a).toBe(b);
  });

  it('changes when the supporting request context changes', () => {
    const a = buildPromptFingerprint({
      question: 'Front pushes on entry',
      symptoms: ['understeer_entry'],
      changeIntent: 'sharper_turn_in',
      secret: TEST_SECRET,
    });
    const b = buildPromptFingerprint({
      question: 'Front pushes on entry',
      symptoms: ['understeer_entry'],
      changeIntent: 'more_rear_stability',
      secret: TEST_SECRET,
    });
    expect(a).not.toBe(b);
  });

  it('changes when the fingerprint secret changes', () => {
    const a = buildPromptFingerprint({
      question: 'Front pushes on entry',
      symptoms: ['understeer_entry'],
      changeIntent: 'sharper_turn_in',
      secret: 'secret-a',
    });
    const b = buildPromptFingerprint({
      question: 'Front pushes on entry',
      symptoms: ['understeer_entry'],
      changeIntent: 'sharper_turn_in',
      secret: 'secret-b',
    });
    expect(a).not.toBe(b);
  });
});

describe('buildPromptRedactedPreview', () => {
  it('redacts urls, emails, uuids, and long numbers', () => {
    const preview = buildPromptRedactedPreview(
      'Email me at rider@example.com, open https://example.com, reference 123456789, session 123e4567-e89b-12d3-a456-426614174000.',
    );
    expect(preview).toContain('[email]');
    expect(preview).toContain('[url]');
    expect(preview).toContain('[number]');
    expect(preview).toContain('[id]');
    expect(preview).not.toContain('rider@example.com');
    expect(preview).not.toContain('https://example.com');
  });

  it('caps preview length', () => {
    const preview = buildPromptRedactedPreview('a'.repeat(200));
    expect(preview.length).toBeLessThanOrEqual(140);
    expect(preview.endsWith('…')).toBe(true);
  });
});

/**
 * The preview before `redactForStorage` existed, for text that carries no phone
 * number and no schemeless link. Each expected string was produced by the
 * previous implementation (`redactSensitiveTokens`, url -> email -> uuid ->
 * long number) and is pinned here, so moving the preview onto the shared helper
 * is shown not to have changed a byte of what `ai:requests` prints for it.
 */
describe('buildPromptRedactedPreview is byte-identical to the pre-refactor preview', () => {
  it.each([
    [
      'Front pushes on entry after I raised pressure 1 psi. What next?',
      'Front pushes on entry after I raised pressure 1 psi. What next?',
    ],
    [
      'Email me at rider@example.com, open https://example.com, reference 123456789, session 123e4567-e89b-12d3-a456-426614174000.',
      'Email me at [email], open [url] reference [number], session [id].',
    ],
    [
      'Best lap 1:23.456, then 1:24.012 after going 32.5 psi hot on the rear.',
      'Best lap 1:23.456, then 1:24.012 after going 32.5 psi hot on the rear.',
    ],
    [
      'My 2019 ZX-6R with 320mm discs and 4-piston calipers; added 10 clicks of rebound.',
      'My 2019 ZX-6R with 320mm discs and 4-piston calipers; added 10 clicks of rebound.',
    ],
    [
      'day-plan 2026-09-25 | Road Atlanta | light rain | damp',
      'day-plan 2026-09-25 | Road Atlanta | light rain | damp',
    ],
    [
      'Went from 30 to 32 psi, fork height 2 mm, 1-2 clicks softer. Ran 25.09.2026 at Barber.',
      'Went from 30 to 32 psi, fork height 2 mm, 1-2 clicks softer. Ran 25.09.2026 at Barber.',
    ],
    ['   lots   of\n\nwhitespace   ', 'lots of whitespace'],
    [
      'rpm 900-1100 at idle, shift at 12000, 500-1500 rpm band',
      'rpm 900-1100 at idle, shift at 12000, 500-1500 rpm band',
    ],
    [
      'e.g. i.e. vs. etc. rebound.Then psi.The R1. S1000RR Q3.',
      'e.g. i.e. vs. etc. rebound.Then psi.The R1. S1000RR Q3.',
    ],
  ])('%j', (input, expected) => {
    expect(buildPromptRedactedPreview(input)).toBe(expected);
  });
});

describe('redactForStorage', () => {
  it.each([
    ['an email address', 'mail rider.one+track@example.co.uk now', 'mail [email] now'],
    ['a scheme link', 'see https://example.com/a?b=1 now', 'see [url] now'],
    ['a www link', 'see www.example.com/setup now', 'see [url] now'],
    ['a bare host name', 'see trackdaytuner.com for it', 'see [url] for it'],
    ['a bare host name with a path', 'see forum.example.org/t/123 now', 'see [url] now'],
    ['a UUID', 'id 123e4567-e89b-12d3-a456-426614174000 now', 'id [id] now'],
    ['a North American number', 'call 555 123 4567 now', 'call [phone] now'],
    ['a dashed number', 'call 555-123-4567 now', 'call [phone] now'],
    ['a dotted number', 'call 555.123.4567 now', 'call [phone] now'],
    ['an area code in brackets', 'call (555) 123-4567 now', 'call [phone] now'],
    ['a UK landline', 'call (020) 7946 0958 now', 'call [phone] now'],
    ['an international number', 'call +44 20 7946 0958 now', 'call [phone] now'],
    ['an international number with a bracketed code', 'call +1 (555) 123-4567 now', 'call [phone] now'],
    ['an unseparated international number', 'call +447700900123 now', 'call [phone] now'],
    ['a long digit run', 'ref 1234567 now', 'ref [number] now'],
  ])('masks %s', (_label, input, expected) => {
    expect(redactForStorage(input)).toBe(expected);
  });

  // What riders actually type about setup. None of it may be masked: a replay
  // of a masked pressure or lap time is a different question.
  it.each([
    ['a lap time', 'best 1:23.456 then 1:24.012'],
    ['a pressure', '32.5 psi hot, 30 cold'],
    ['a pressure list', 'fronts 30 31 32 33 psi'],
    ['a disc size', '320mm discs'],
    ['a model year and bike', '2019 ZX-6R'],
    ['a caliper', '4-piston calipers'],
    ['clicks', '10 clicks out, 1-2 clicks softer'],
    ['an ISO date', '2026-09-25'],
    ['a European date', '25.09.2026'],
    ['an rpm range', 'idle 900-1100, band 500-1500 rpm'],
    ['a list of model years', 'raced 2019 2020 2021'],
    ['a short signed delta', '+1 psi, +10 20 clicks'],
    ['sag figures', 'sag 35mm/30mm, 25 30 35'],
    ['abbreviations and missing spaces', 'e.g. i.e. vs. rebound.Then psi.The'],
  ])('leaves %s alone', (_label, input) => {
    expect(redactForStorage(input)).toBe(input);
  });

  it('does not collapse whitespace or truncate', () => {
    const long = `  ${'word '.repeat(60)}  `;
    expect(redactForStorage(long)).toBe(long);
  });
});
