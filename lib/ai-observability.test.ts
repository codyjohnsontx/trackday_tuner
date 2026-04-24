import { describe, expect, it } from 'vitest';
import {
  buildPromptFingerprint,
  buildPromptRedactedPreview,
} from '@/lib/ai-observability';

describe('buildPromptFingerprint', () => {
  it('is stable across casing and repeated whitespace', () => {
    const a = buildPromptFingerprint({
      question: ' Front pushes on entry ',
      symptoms: ['understeer_entry'],
      changeIntent: 'sharper_turn_in',
    });
    const b = buildPromptFingerprint({
      question: 'front pushes   on entry',
      symptoms: ['understeer_entry'],
      changeIntent: 'sharper_turn_in',
    });
    expect(a).toBe(b);
  });

  it('changes when the supporting request context changes', () => {
    const a = buildPromptFingerprint({
      question: 'Front pushes on entry',
      symptoms: ['understeer_entry'],
      changeIntent: 'sharper_turn_in',
    });
    const b = buildPromptFingerprint({
      question: 'Front pushes on entry',
      symptoms: ['understeer_entry'],
      changeIntent: 'more_rear_stability',
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
