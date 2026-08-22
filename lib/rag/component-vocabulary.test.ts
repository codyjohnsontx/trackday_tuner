import { describe, expect, it } from 'vitest';
import {
  COMPONENT_POLICIES,
  describeComponentVocabulary,
  directionAllowed,
  formatComponentLabel,
  formatDirectionLabel,
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

describe('formatDirectionLabel', () => {
  it('renders the vocabulary directions as a rider reads them', () => {
    expect(formatDirectionLabel('soften')).toBe('Soften');
    expect(formatDirectionLabel('lower')).toBe('Lower');
    expect(formatDirectionLabel('toe-in')).toBe('Toe-in');
    expect(formatDirectionLabel('shorter gearing')).toBe('Shorter gearing');
    expect(formatDirectionLabel('reduce negative camber')).toBe('Reduce negative camber');
  });

  it('answers with the canonical spelling whatever separator arrived', () => {
    expect(formatDirectionLabel('toe_in')).toBe('Toe-in');
    expect(formatDirectionLabel('TOE-OUT')).toBe('Toe-out');
    expect(formatDirectionLabel('shorter_gearing')).toBe('Shorter gearing');
  });

  it('passes anything it does not recognise through unchanged', () => {
    // ai_recommendations rows written before the vocabulary existed hold prose
    // like this, and they still have to read correctly in the outcome picker.
    expect(formatDirectionLabel('Return toward baseline')).toBe('Return toward baseline');
    expect(formatDirectionLabel('')).toBe('');
  });

  it('formats every direction the model is told to emit', () => {
    for (const policy of Object.values(COMPONENT_POLICIES)) {
      for (const direction of policy.directions) {
        const label = formatDirectionLabel(direction);
        expect(label).not.toContain('_');
        expect(label[0]).toBe(label[0]?.toUpperCase());
        expect(label.toLowerCase()).toBe(direction.toLowerCase());
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


// ---------------------------------------------------------------------------
// directionAllowed
//
// This guard decides whether a setup instruction reaches the rider, so BOTH
// walls are pinned, and each case is labelled with which one it defends. That
// convention came out of the actionable-prose guard in lib/rag/policy.test.ts,
// where moving the rule in either direction repeatedly broke the other side.
//
// WALL ONE - wrongly ACCEPTED. A direction that does not instruct what the
// vocabulary says it instructs, arriving with a valid component and a legal
// magnitude and rendering to the rider as a checked recommendation.
// WALL TWO - wrongly REFUSED. A correct recommendation discarded whole, which
// is the failure mode this change actually risks.
//
// The negation list below is derived rather than sampled: every prefix is
// applied to every canonical direction against every policy, because a guard
// proved on two examples is a guard proved on nothing.
// ---------------------------------------------------------------------------

const ALL_DIRECTIONS = [
  ...new Set(Object.values(COMPONENT_POLICIES).flatMap((policy) => policy.directions)),
].sort();

const POLICY_ENTRIES = Object.entries(COMPONENT_POLICIES);

describe('directionAllowed', () => {
  // WALL TWO. Every direction the prompt names, against the component it is
  // named for. Exhaustive over the table rather than a sample, so adding a
  // direction to COMPONENT_POLICIES without teaching the guard about it fails
  // here rather than in production.
  describe('must accept', () => {
    it('accepts every canonical direction for the component that lists it', () => {
      for (const [key, policy] of POLICY_ENTRIES) {
        for (const direction of policy.directions) {
          expect(directionAllowed(policy, direction), `${key} / ${direction}`).toBe(true);
        }
      }
    });

    // The three things a model varies freely and that carry no meaning here.
    // Each is folded on purpose; see the doc comment on directionAllowed.
    it.each([
      ['casing, which model JSON varies freely', (d: string) => d.toUpperCase()],
      ['leading and trailing whitespace', (d: string) => `  ${d}\n`],
      ['an underscore separator, as the component aliases already use', (d: string) => d.replace(/[-\s]+/g, '_')],
      ['a space separator where the canonical spelling hyphenates', (d: string) => d.replace(/-/g, ' ')],
      ['a doubled space inside a multi-word direction', (d: string) => d.replace(/ /g, '  ')],
    ])('accepts every canonical direction through %s', (_label, mutate) => {
      for (const [key, policy] of POLICY_ENTRIES) {
        for (const direction of policy.directions) {
          const probe = mutate(direction);
          expect(directionAllowed(policy, probe), `${key} / ${JSON.stringify(probe)}`).toBe(true);
        }
      }
    });
  });

  // WALL ONE. Containment accepted all of these: the canonical word was present,
  // so the guard answered yes to a string that instructs the opposite, instructs
  // nothing, or instructs something this component does not offer.
  describe('must refuse', () => {
    // Thirteen ways to say "not". Written out rather than reduced to a pattern
    // because the point of the fix is that the guard no longer tries to
    // recognise negation at all - it recognises the accepted values, and
    // everything here fails for the same structural reason: it has extra words.
    const NEGATIONS: Array<[string, (d: string) => string]> = [
      ['a plain prohibition', (d) => `do not ${d}`],
      ['a shouted prohibition', (d) => `do NOT ${d}`],
      ['a contracted prohibition', (d) => `don't ${d}`],
      ['an absolute prohibition', (d) => `never ${d}`],
      ['a bare negative', (d) => `not ${d}`],
      ['a nominal negative', (d) => `no ${d}`],
      ['an avoidance', (d) => `avoid ${d}`],
      ['a modal prohibition', (d) => `must not ${d}`],
      ['an ability negation', (d) => `cannot ${d}`],
      ['a cessation', (d) => `stop ${d}`],
      ['a replacement preference', (d) => `rather than ${d}`],
      ['a substitution', (d) => `instead of ${d}`],
      ['an emphatic prohibition', (d) => `under no circumstances ${d}`],
    ];

    it.each(NEGATIONS)('refuses %s of every canonical direction', (_label, negate) => {
      for (const [key, policy] of POLICY_ENTRIES) {
        for (const direction of ALL_DIRECTIONS) {
          const probe = negate(direction);
          expect(directionAllowed(policy, probe), `${key} / ${JSON.stringify(probe)}`).toBe(false);
        }
      }
    });

    // The named cases from the report, kept literal so the two examples that
    // opened the ticket are visibly covered rather than merely implied.
    it('refuses the two reported values outright', () => {
      expect(directionAllowed(COMPONENT_POLICIES.tire_pressure, 'do not increase')).toBe(false);
      expect(directionAllowed(COMPONENT_POLICIES.tire_pressure, 'never increase')).toBe(false);
    });

    // Everything else containment let through that is not a negation.
    it.each([
      ['a paraphrase naming the component back', 'tire_pressure', 'increase tire pressure'],
      ['a paraphrase carrying the whole instruction', 'tire_pressure', 'increase front tire pressure by 1 psi'],
      ['a paraphrase naming a damper', 'rebound', 'soften front rebound'],
      ['two intents in one value', 'rebound', 'increase or decrease depending on grip'],
      ['an instruction to hold, negating the direction it names', 'rebound', 'hold; do not soften'],
      ['a direction curated for a different component', 'tire_pressure', 'increase negative camber'],
      ['an uncurated phrase riding on a canonical word', 'camber', 'decrease negative camber'],
      ['a conditional rather than an instruction', 'tire_pressure', 'increase if the track heats up'],
      ['a near-miss the vocabulary deliberately does not list', 'rebound', 'softer'],
      ['a participle, which is not the imperative the prompt asks for', 'tire_pressure', 'increasing'],
      ['the empty string', 'tire_pressure', ''],
      ['whitespace alone', 'tire_pressure', '   '],
    ] as Array<[string, keyof typeof COMPONENT_POLICIES, string]>)(
      'refuses %s',
      (_label, key, probe) => {
        expect(directionAllowed(COMPONENT_POLICIES[key], probe)).toBe(false);
      },
    );

    // Equality is per policy, not global. `soften` is a real direction, just not
    // one a tire has, and containment could never express that distinction
    // because the check ran over one policy's list at a time anyway - what it
    // could not express was the boundary of the STRING.
    it('refuses a canonical direction against a component that does not offer it', () => {
      expect(directionAllowed(COMPONENT_POLICIES.tire_pressure, 'soften')).toBe(false);
      expect(directionAllowed(COMPONENT_POLICIES.tire_pressure, 'toe-in')).toBe(false);
      expect(directionAllowed(COMPONENT_POLICIES.wing_angle, 'shorter gearing')).toBe(false);
      expect(directionAllowed(COMPONENT_POLICIES.rebound, 'reduce negative camber')).toBe(false);
    });
  });

  // Properties of the normalizer itself, pinned separately from any phrasing so
  // a future vocabulary addition cannot break them quietly.
  describe('normalizer properties', () => {
    it('never collapses two directions of one component onto one key', () => {
      // Two directions that normalize alike would silently merge two meanings.
      // DIRECTION_LABELS is a Map keyed by that same normalizer, so the later
      // spelling overwrites the earlier and the rider is shown the wrong word
      // for one of them.
      //
      // Probed through formatDirectionLabel because that runs the REAL
      // normalizer. This assertion first re-implemented directionKey inline,
      // which guarded a COPY of the rule rather than the rule: it would have
      // kept passing through exactly the loosening it exists to catch.
      for (const [key, policy] of POLICY_ENTRIES) {
        const labels = policy.directions.map((d) => formatDirectionLabel(d).toLowerCase());
        expect(new Set(labels).size, `${key}: ${labels.join(', ')}`).toBe(labels.length);
      }
    });

    it('agrees with the label half about what every canonical direction is', () => {
      // directionAllowed and formatDirectionLabel share one normalizer. If they
      // ever stop agreeing, a value the guard accepts renders as a stranger, or
      // one it refuses renders as canonical.
      for (const [key, policy] of POLICY_ENTRIES) {
        for (const direction of policy.directions) {
          const label = formatDirectionLabel(direction.replace(/[-\s]+/g, '_'));
          expect(label.toLowerCase(), key).toBe(direction.toLowerCase());
          expect(directionAllowed(policy, label), `${key} / ${label}`).toBe(true);
        }
      }
    });
  });
});
