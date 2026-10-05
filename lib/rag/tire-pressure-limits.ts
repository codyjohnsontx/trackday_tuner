import type { VehicleType } from '@/types';

/**
 * The absolute tire pressure envelope the dangerous-VALUE premise arm reads.
 *
 * WHY THIS FILE EXISTS. `docs/knowledge-base/tires/pressure-basics.md` is
 * deliberately about CHANGES - 0.5 psi steps, cold-to-hot deltas - and names the
 * manufacturer and tire supplier as the authority on absolute targets, because
 * the right pressure varies by chassis, tire, rider weight and venue. That left
 * the premise guard with nothing to compare a value against: asked to be told to
 * run 50 psi in a motorcycle front, the pipeline had no number that said 50 was
 * absurd, and whether the rider was warned was left to the model
 * (`adversarial-request-unsafe-pressure`, recorded in `eval-baseline.json`).
 *
 * Captain's decision, 2026-10-04: the guard extends from dangerous ACTIONS to
 * dangerous VALUES, starting with tire pressure. So the knowledge base gains a
 * document of PUBLISHED absolute figures with a source for each
 * (`docs/knowledge-base/tires/pressure-limits.md`), and this module is the same
 * figures as code. `lib/rag/tire-pressure-limits.test.ts` reads that markdown
 * and fails if a figure or a source URL here is missing from it, so the number
 * the guard rejects on is always one the knowledge base states and cites.
 *
 * THE ENVELOPE IS NOT A RECOMMENDATION. It is the OUTERMOST figure any cited
 * maker publishes for any track or road tire of that vehicle class - the lowest
 * cold minimum and the highest cold maximum found - so it is far wider than any
 * one tire's window. The guard is a floor on absurdity, not a setup target: a
 * value inside the envelope but outside a particular tire's range is for the
 * model to talk about, with the knowledge-base document in front of it.
 *
 * THE GUARD BAND IS WIDER STILL, by `TIRE_PRESSURE_GUARD_TOLERANCE_PSI` on each
 * side. That figure is the largest cold-to-hot gain `pressure-basics.md` states
 * (3-6 psi), and it is there so a rider reporting a HOT reading just above a
 * COLD maximum is not shown the safety card, and a gauge or rounding difference
 * at the bottom is not either. `PremiseRejectionCard` is the largest block on
 * the screen; a card shown over a legitimate hot reading teaches the rider to
 * scroll past it (see `lib/rag/premise-guard.ts`).
 *
 * UNITS. Everything here is psi, the unit the session form stores and the
 * golden set speaks. `toPsi` is the one conversion for bar and kPa.
 */

export interface TirePressureSource {
  /** Who published the figure, as the knowledge-base document names them. */
  publisher: string;
  /** Where it was read. Appears verbatim in the knowledge-base document. */
  url: string;
  /**
   * The figures taken from that source, as the knowledge-base document states
   * them. The agreement test looks for each entry in the markdown.
   */
  figures: string[];
}

export interface PublishedPressureEnvelope {
  vehicleType: VehicleType;
  /** The lowest pressure, in psi, any cited maker publishes for this class. */
  minPsi: number;
  /** The highest pressure, in psi, any cited maker publishes for this class. */
  maxPsi: number;
  sources: TirePressureSource[];
}

/** Repo-relative path of the knowledge-base document that cites every figure. */
export const TIRE_PRESSURE_LIMITS_DOC = 'docs/knowledge-base/tires/pressure-limits.md';

/**
 * Taken from `docs/knowledge-base/tires/pressure-basics.md`: "A typical track
 * tire gains 3-6 psi from cold to hot". The upper end, so a hot reading is never
 * read as a cold one that broke the envelope.
 */
export const TIRE_PRESSURE_GUARD_TOLERANCE_PSI = 6;

export const TIRE_PRESSURE_PUBLISHED_ENVELOPE: Record<VehicleType, PublishedPressureEnvelope> = {
  motorcycle: {
    vehicleType: 'motorcycle',
    // Pirelli's lowest published figure is a 10-inch minimoto rear; the lowest
    // 17-inch figure is Dunlop's 19 psi cold rear. The envelope takes the lower.
    minPsi: 16,
    // Dunlop's SportSmart TT 170/60 ZR17 rear at 2.9 bar cold is the highest
    // pressure any cited maker recommends, and Dunlop's care page says never to
    // exceed the sidewall figure, which on common sport sizes is the same 42 psi.
    maxPsi: 42,
    sources: [
      {
        publisher: 'Pirelli, DIABLO Superbike pressure table',
        url: 'https://www.pirelli.com/tyres/en-ww/motorcycle/catalogue/product/diablo-superbike',
        figures: [
          '120/70 R17 front: cold 2.1-2.2 bar (30-32 psi), hot 2.2-2.5 bar (32-36 psi)',
          '160/60 to 200/65 R17 rear: cold 1.6-1.8 bar (23-26 psi), hot 1.7-1.9 bar (25-28 psi)',
          '120/80-10 rear (minimoto): cold 1.1-1.2 bar (16-17 psi)',
        ],
      },
      {
        publisher: 'Dunlop Racing, Sportmax Slick and KR pressure table',
        url: 'https://www.dunlopracing.com/product/slicks/',
        figures: [
          '110/70 R17 front: cold 32-36 psi, hot 34-38 psi',
          '180/60 to 200/60 R17 rear: cold 19-22 psi, hot 22-27 psi',
        ],
      },
      {
        publisher: 'Dunlop Europe, track tyre pressure information',
        url: 'https://www.dunlop-moto.com/en_gb/safety-and-technology/tire-pressure-information.html',
        figures: [
          'KR108 slick rear: cold 1.5-1.7 bar, minimum 1.4 bar (20 psi)',
          'SportSmart TT 170/60 ZR17 rear: cold 2.7-2.9 bar (39-42 psi)',
        ],
      },
      {
        publisher: 'Dunlop Motorcycle Tires, care and maintenance',
        url: 'https://www.dunlopmotorcycletires.com/about/care/',
        figures: [
          'never exceed the maximum indicated on the tire sidewall',
        ],
      },
    ],
  },
  car: {
    vehicleType: 'car',
    // Toyo's very-light-car cold range starts at 17 psi, the lowest any cited
    // maker publishes for a track tire.
    minPsi: 17,
    // The maximum inflation pressure branded on a P-metric standard load
    // sidewall is 44 or 51 psi; the envelope takes the higher.
    maxPsi: 51,
    sources: [
      {
        publisher: 'Toyo Tires UK, Proxes R888R set-up advice',
        url: 'https://www.toyo.co.uk/page/index/identifier/set-up-advice',
        figures: [
          'very light car (under 800 kg): cold 17-22 psi, hot 22-29 psi',
          'very heavy car (over 1400 kg): cold 27-35 psi, hot 37-40 psi',
          'maximum hot pressure 40 psi',
        ],
      },
      {
        publisher: 'Hoosier Racing Tire, R7 and A7 care and safety guidelines',
        url: 'https://www.hoosiertire.com/images/content/files/TCTR7_A7(1).pdf',
        figures: [
          'minimum cold pressure 26 psi on all DOT radials',
          'over 3000 lb: cold 30-34 psi, hot 40-42+ psi',
        ],
      },
      {
        publisher: 'Michelin UK, Pilot Sport Cup 2 R technical bulletin',
        url: 'https://marketing.michelin.co.uk/p/PDF/Technical%20Bulletin_PSC2R.pdf',
        figures: [
          'hot 2.3-2.7 bar (33-40 psi)',
          'never below 2.0 bar (29 psi)',
        ],
      },
      {
        publisher: 'Tire Review, Determining the right PSI',
        url: 'https://www.tirereview.com/determining-the-right-psi/',
        figures: [
          'P-metric standard load sidewall maximum 44 psi or 51 psi',
        ],
      },
    ],
  },
};

export type PressureUnit = 'psi' | 'bar' | 'kpa';

const PSI_PER_BAR = 14.5038;
const KPA_PER_PSI = 6.89476;

/** The one conversion. bar and kPa are what European riders and tables use. */
export function toPsi(value: number, unit: PressureUnit): number {
  switch (unit) {
    case 'psi':
      return value;
    case 'bar':
      return value * PSI_PER_BAR;
    case 'kpa':
      return value / KPA_PER_PSI;
  }
}

export interface TirePressureGuardBand {
  /** Null when the vehicle type is unknown and the widest band is in force. */
  envelope: PublishedPressureEnvelope | null;
  /** A value strictly below this, in psi, is a dangerous premise. */
  rejectBelowPsi: number;
  /** A value strictly above this, in psi, is a dangerous premise. */
  rejectAbovePsi: number;
}

/**
 * The band the guard rejects outside of, for one vehicle class.
 *
 * An UNKNOWN vehicle type takes the widest band - the lowest floor and the
 * highest ceiling across every class - because the fail-safe direction for a
 * lexical guard is not firing: a card over a legitimate car pressure, shown
 * because the type was not known, is the misfire the tolerance exists to avoid.
 * The route always knows the vehicle, so this is the harness and test path.
 */
export function tirePressureGuardBand(vehicleType: VehicleType | null | undefined): TirePressureGuardBand {
  const envelopes = Object.values(TIRE_PRESSURE_PUBLISHED_ENVELOPE);
  if (vehicleType && vehicleType in TIRE_PRESSURE_PUBLISHED_ENVELOPE) {
    const envelope = TIRE_PRESSURE_PUBLISHED_ENVELOPE[vehicleType];
    return {
      envelope,
      rejectBelowPsi: envelope.minPsi - TIRE_PRESSURE_GUARD_TOLERANCE_PSI,
      rejectAbovePsi: envelope.maxPsi + TIRE_PRESSURE_GUARD_TOLERANCE_PSI,
    };
  }
  return {
    envelope: null,
    rejectBelowPsi: Math.min(...envelopes.map((e) => e.minPsi)) - TIRE_PRESSURE_GUARD_TOLERANCE_PSI,
    rejectAbovePsi: Math.max(...envelopes.map((e) => e.maxPsi)) + TIRE_PRESSURE_GUARD_TOLERANCE_PSI,
  };
}
