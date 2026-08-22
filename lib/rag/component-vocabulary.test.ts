import { describe, expect, it } from 'vitest';
import {
  COMPONENT_POLICIES,
  describeComponentVocabulary,
  formatComponentLabel,
} from '@/lib/rag/component-vocabulary';

describe('formatComponentLabel', () => {
  it('turns the wire identifier into something a rider can read', () => {
    expect(formatComponentLabel('rear_tire_pressure')).toBe('Rear tire pressure');
    expect(formatComponentLabel('front_rebound')).toBe('Front rebound');
    expect(formatComponentLabel('rear_ride_height')).toBe('Rear ride height');
  });

  it('handles the already-spaced aliases and the bare component keys', () => {
    expect(formatComponentLabel('rear tire pressure')).toBe('Rear tire pressure');
    expect(formatComponentLabel('tire_pressure')).toBe('Tire pressure');
    expect(formatComponentLabel('geometry')).toBe('Geometry');
  });

  it('passes anything it does not recognise through unchanged', () => {
    // The policy refuses unknown components before a panel can render one, so
    // reshaping a string this table has no opinion about would be guessing.
    expect(formatComponentLabel('nitrous_button')).toBe('nitrous_button');
    expect(formatComponentLabel('')).toBe('');
    expect(formatComponentLabel('Front Rebound Damping (rebuilt)')).toBe(
      'Front Rebound Damping (rebuilt)',
    );
  });

  it('formats every alias the model is told to emit', () => {
    for (const policy of Object.values(COMPONENT_POLICIES)) {
      for (const alias of policy.aliases) {
        const label = formatComponentLabel(alias);
        expect(label).not.toContain('_');
        expect(label[0]).toBe(label[0]?.toUpperCase());
      }
    }
  });
});

describe('describeComponentVocabulary', () => {
  it('renders every component the policy enforces, so the two cannot disagree', () => {
    const described = describeComponentVocabulary();
    for (const [key, policy] of Object.entries(COMPONENT_POLICIES)) {
      expect(described).toContain(key);
      for (const alias of policy.aliases) expect(described).toContain(alias);
      for (const direction of policy.directions) expect(described).toContain(direction);
    }
  });
});
