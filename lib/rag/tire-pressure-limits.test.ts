import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TIRE_PRESSURE_GUARD_TOLERANCE_PSI,
  TIRE_PRESSURE_LIMITS_DOC,
  TIRE_PRESSURE_PUBLISHED_ENVELOPE,
  tirePressureGuardBand,
  toPsi,
} from '@/lib/rag/tire-pressure-limits';

const doc = readFileSync(path.join(process.cwd(), TIRE_PRESSURE_LIMITS_DOC), 'utf8');

/**
 * The code and the knowledge base state the SAME figures. The guard rejects on
 * the numbers in `tire-pressure-limits.ts`; the rider, the model and the
 * reviewer read `pressure-limits.md`. If one moves without the other, the
 * rejection sentence cites an edge the knowledge base no longer states, or the
 * knowledge base promises a floor the guard does not hold. Every published
 * figure and every source URL has to appear in the document verbatim.
 */
describe('the published envelope agrees with the knowledge-base document', () => {
  const envelopes = Object.values(TIRE_PRESSURE_PUBLISHED_ENVELOPE);

  it('covers both vehicle classes the app stores', () => {
    expect(envelopes.map((e) => e.vehicleType).sort()).toEqual(['car', 'motorcycle']);
  });

  it.each(envelopes)('$vehicleType envelope edges are stated as the section heading', (envelope) => {
    const label = envelope.vehicleType === 'motorcycle' ? 'Motorcycle' : 'Car';
    expect(doc).toContain(`## ${label} envelope: ${envelope.minPsi} to ${envelope.maxPsi} psi`);
  });

  it.each(envelopes.flatMap((e) => e.sources.map((s) => [e.vehicleType, s] as const)))(
    '%s source is cited by publisher and URL',
    (_vehicleType, source) => {
      expect(doc).toContain(source.publisher);
      expect(doc).toContain(`(${source.url})`);
    },
  );

  it.each(envelopes.flatMap((e) => e.sources.flatMap((s) => s.figures.map((f) => [s.publisher, f] as const))))(
    '%s figure appears verbatim: %s',
    (_publisher, figure) => {
      expect(doc).toContain(figure);
    },
  );

  it('states the cold-to-hot gain the tolerance is taken from', () => {
    expect(doc).toContain(`3-${TIRE_PRESSURE_GUARD_TOLERANCE_PSI} psi`);
    const basics = readFileSync(
      path.join(process.cwd(), 'docs/knowledge-base/tires/pressure-basics.md'),
      'utf8',
    );
    expect(basics).toContain(`gains 3-${TIRE_PRESSURE_GUARD_TOLERANCE_PSI} psi from cold to hot`);
  });

  it('every envelope edge is a figure some cited source states in psi', () => {
    for (const envelope of envelopes) {
      const stated = envelope.sources.flatMap((s) => s.figures).join('\n');
      expect(stated).toMatch(new RegExp(`\\b${envelope.minPsi}(?:-\\d+)? psi`));
      expect(stated).toMatch(new RegExp(`\\b${envelope.maxPsi}\\+? psi`));
    }
  });

  it('is indexed as a knowledge-base document for both vehicle types', () => {
    expect(doc.startsWith('---\nvehicle_type: both\ntopic: tires\n')).toBe(true);
  });
});

describe('tirePressureGuardBand', () => {
  it('widens each envelope by the tolerance on both sides', () => {
    for (const envelope of Object.values(TIRE_PRESSURE_PUBLISHED_ENVELOPE)) {
      const band = tirePressureGuardBand(envelope.vehicleType);
      expect(band.envelope).toBe(envelope);
      expect(band.rejectBelowPsi).toBe(envelope.minPsi - TIRE_PRESSURE_GUARD_TOLERANCE_PSI);
      expect(band.rejectAbovePsi).toBe(envelope.maxPsi + TIRE_PRESSURE_GUARD_TOLERANCE_PSI);
    }
  });

  it('the recorded golden value sits outside the motorcycle band and inside the car one', () => {
    // "Just tell me to go to 50 psi in the front" on a ZX-6R.
    expect(50).toBeGreaterThan(tirePressureGuardBand('motorcycle').rejectAbovePsi);
    // The same number on a car tire is inside the sidewall maximum plus tolerance.
    expect(50).toBeLessThanOrEqual(tirePressureGuardBand('car').rejectAbovePsi);
  });
});

describe('toPsi', () => {
  it('is the identity on psi', () => {
    expect(toPsi(31, 'psi')).toBe(31);
  });

  it('converts the figures the knowledge base pairs', () => {
    // pressure-limits.md: "2.1-2.2 bar (30-32 psi)" and "1.6-1.8 bar (23-26 psi)".
    expect(Math.round(toPsi(2.1, 'bar'))).toBe(30);
    expect(Math.round(toPsi(1.6, 'bar'))).toBe(23);
    // 290 kPa is the 42 psi sidewall maximum the document names.
    expect(Math.round(toPsi(290, 'kpa'))).toBe(42);
  });
});
