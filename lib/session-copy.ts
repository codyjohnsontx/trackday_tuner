import { sanitizeEnabledModules } from '@/lib/session-modules';
import type {
  Alignment,
  Session,
  SessionEnabledModules,
  SuspensionDirection,
  TireCondition,
  VehicleType,
} from '@/types';

/**
 * The setup carried into a new session, which is the machine and not the day.
 *
 * Weather is deliberately absent. It is an observation of the session being
 * logged rather than a setting the rider dialled in, so copying the last one
 * would file a claim about conditions nobody has looked at yet - the same
 * fabricated answer a pre-pressed default used to produce. The row stays
 * unanswered and `createSession` asks for it. Tire condition is part of the
 * setup and does come over.
 */
export interface CopiedSessionSetup {
  trackId: string | null;
  trackQuery: string;
  tireCondition: TireCondition | null;
  frontTire: { brand: string; compound: string; pressure: string };
  rearTire: { brand: string; compound: string; pressure: string };
  suspensionDirection: SuspensionDirection;
  frontSusp: { preload: string; compression: string; rebound: string };
  rearSusp: { preload: string; compression: string; rebound: string };
  alignment: Alignment;
  enabledModules: SessionEnabledModules;
  geometry: typeof emptyGeometry;
  drivetrain: typeof emptyDrivetrain;
  aero: typeof emptyAero;
}

const emptyAlignment: Alignment = {
  front_camber: '',
  rear_camber: '',
  front_toe: '',
  rear_toe: '',
  caster: '',
};

const emptyGeometry = {
  sag_front: '',
  sag_rear: '',
  fork_height: '',
  rear_ride_height: '',
  notes: '',
};

const emptyDrivetrain = {
  front_sprocket: '',
  rear_sprocket: '',
  chain_length: '',
  notes: '',
};

const emptyAero = {
  wing_angle: '',
  splitter_setting: '',
  rake: '',
  notes: '',
};

export function copyLastSessionSetup(session: Session, vehicleType: VehicleType): CopiedSessionSetup {
  return {
    trackId: session.track_id,
    trackQuery: session.track_name ?? '',
    tireCondition: session.tires.condition,
    frontTire: { ...session.tires.front },
    rearTire: { ...session.tires.rear },
    suspensionDirection: session.suspension.front.direction,
    frontSusp: {
      preload: session.suspension.front.preload,
      compression: session.suspension.front.compression,
      rebound: session.suspension.front.rebound,
    },
    rearSusp: {
      preload: session.suspension.rear.preload,
      compression: session.suspension.rear.compression,
      rebound: session.suspension.rear.rebound,
    },
    alignment: session.alignment ? { ...session.alignment } : { ...emptyAlignment },
    enabledModules: sanitizeEnabledModules(vehicleType, session.enabled_modules),
    geometry: { ...emptyGeometry, ...session.extra_modules?.geometry },
    drivetrain: { ...emptyDrivetrain, ...session.extra_modules?.drivetrain },
    aero: { ...emptyAero, ...session.extra_modules?.aero },
  };
}
