import { DEMO_USER_ID } from '@/lib/demo/mode';
import { compareSessionsDesc, isSessionBefore, sessionsMatchTrack } from '@/lib/session-compare';
import type {
  Profile,
  Session,
  SessionEnvironment,
  SessionEnabledModules,
  TelemetrySummary,
  Track,
  Vehicle,
  VehicleBaseline,
} from '@/types';

const createdAt = '2026-05-18T14:00:00.000Z';

const allMotorcycleModules: SessionEnabledModules = {
  tires: true,
  suspension: true,
  alignment: false,
  geometry: true,
  drivetrain: true,
  aero: false,
  notes: true,
};

export const DEMO_PROFILE: Profile = {
  id: DEMO_USER_ID,
  tier: 'pro',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  stripe_price_id: null,
  stripe_current_period_end: null,
};

export const DEMO_VEHICLES: Vehicle[] = [
  {
    id: 'demo-r6',
    user_id: DEMO_USER_ID,
    nickname: 'R6 Track Bike',
    type: 'motorcycle',
    year: 2020,
    make: 'Yamaha',
    model: 'YZF-R6',
    photo_url: null,
    created_at: createdAt,
    updated_at: createdAt,
  },
];

export const DEMO_TRACKS: Track[] = [
  {
    id: 'demo-track-msr-cresson',
    name: 'MSR Cresson 1.7',
    location: 'Cresson, TX',
    is_seeded: true,
    created_by: null,
    created_at: createdAt,
  },
  {
    id: 'demo-track-cota',
    name: 'Circuit of The Americas',
    location: 'Austin, TX',
    is_seeded: true,
    created_by: null,
    created_at: createdAt,
  },
  {
    id: 'demo-track-ecr',
    name: 'Eagles Canyon Raceway',
    location: 'Decatur, TX',
    is_seeded: true,
    created_by: null,
    created_at: createdAt,
  },
];

export const DEMO_SESSIONS: Session[] = [
  {
    id: 'demo-session-4',
    user_id: DEMO_USER_ID,
    vehicle_id: 'demo-r6',
    track_id: 'demo-track-msr-cresson',
    track_name: 'MSR Cresson 1.7',
    date: '2026-05-18',
    start_time: '14:20:00',
    session_number: 4,
    conditions: 'sunny',
    tires: {
      condition: 'used',
      front: { brand: 'Pirelli', compound: 'SC1', pressure: '34 psi hot' },
      rear: { brand: 'Pirelli', compound: 'SC2', pressure: '27 psi hot' },
    },
    suspension: {
      front: { preload: '5 turns', compression: '12 clicks', rebound: '10 clicks', direction: 'out' },
      rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
    },
    alignment: null,
    enabled_modules: allMotorcycleModules,
    extra_modules: {
      geometry: {
        sag_front: '35 mm',
        sag_rear: '29 mm',
        fork_height: '4 mm showing',
        rear_ride_height: 'baseline',
        notes: 'Kept geometry stable as track temp came up.',
      },
      drivetrain: {
        front_sprocket: '15T',
        rear_sprocket: '45T',
        chain_length: '116 links',
        notes: 'Good drive ratio for 1.7 layout.',
      },
    },
    notes:
      'Hotter later session. Rear started feeling greasy after four laps and exit drive fell off. Keep the better front setup from S3, but watch rear pressure as track temp rises.',
    created_at: '2026-05-18T19:45:00.000Z',
    updated_at: '2026-05-18T19:45:00.000Z',
  },
  {
    id: 'demo-session-3',
    user_id: DEMO_USER_ID,
    vehicle_id: 'demo-r6',
    track_id: 'demo-track-msr-cresson',
    track_name: 'MSR Cresson 1.7',
    date: '2026-05-18',
    start_time: '11:30:00',
    session_number: 3,
    conditions: 'sunny',
    tires: {
      condition: 'scrubbed',
      front: { brand: 'Pirelli', compound: 'SC1', pressure: '33 psi hot' },
      rear: { brand: 'Pirelli', compound: 'SC2', pressure: '26 psi hot' },
    },
    suspension: {
      front: { preload: '5 turns', compression: '12 clicks', rebound: '10 clicks', direction: 'out' },
      rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
    },
    alignment: null,
    enabled_modules: allMotorcycleModules,
    extra_modules: {
      geometry: {
        sag_front: '35 mm',
        sag_rear: '29 mm',
        fork_height: '4 mm showing',
        rear_ride_height: 'baseline',
        notes: 'No geometry change. Focused on pressure and compression only.',
      },
      drivetrain: {
        front_sprocket: '15T',
        rear_sprocket: '45T',
        chain_length: '116 links',
        notes: 'Pulls cleanly out of rattlesnake.',
      },
    },
    notes:
      'Lowered front pressure and softened front compression from S2. Better turn-in and front compliance. Bike finished corners without needing extra bar pressure.',
    created_at: '2026-05-18T16:55:00.000Z',
    updated_at: '2026-05-18T16:55:00.000Z',
  },
  {
    id: 'demo-session-2',
    user_id: DEMO_USER_ID,
    vehicle_id: 'demo-r6',
    track_id: 'demo-track-msr-cresson',
    track_name: 'MSR Cresson 1.7',
    date: '2026-05-18',
    start_time: '10:10:00',
    session_number: 2,
    conditions: 'sunny',
    tires: {
      condition: 'scrubbed',
      front: { brand: 'Pirelli', compound: 'SC1', pressure: '35 psi hot' },
      rear: { brand: 'Pirelli', compound: 'SC2', pressure: '26 psi hot' },
    },
    suspension: {
      front: { preload: '5 turns', compression: '10 clicks', rebound: '9 clicks', direction: 'out' },
      rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
    },
    alignment: null,
    enabled_modules: allMotorcycleModules,
    extra_modules: {
      geometry: {
        sag_front: '35 mm',
        sag_rear: '29 mm',
        fork_height: '4 mm showing',
        rear_ride_height: 'baseline',
        notes: 'No ride-height changes.',
      },
      drivetrain: {
        front_sprocket: '15T',
        rear_sprocket: '45T',
        chain_length: '116 links',
        notes: 'Same as baseline.',
      },
    },
    notes:
      'Raised front pressure and added rebound control. Front pushed mid-corner and the bike was harder to finish turns. Felt worse than baseline.',
    created_at: '2026-05-18T15:35:00.000Z',
    updated_at: '2026-05-18T15:35:00.000Z',
  },
  {
    id: 'demo-session-1',
    user_id: DEMO_USER_ID,
    vehicle_id: 'demo-r6',
    track_id: 'demo-track-msr-cresson',
    track_name: 'MSR Cresson 1.7',
    date: '2026-05-18',
    start_time: '08:40:00',
    session_number: 1,
    conditions: 'sunny',
    tires: {
      condition: 'scrubbed',
      front: { brand: 'Pirelli', compound: 'SC1', pressure: '33 psi hot' },
      rear: { brand: 'Pirelli', compound: 'SC2', pressure: '26 psi hot' },
    },
    suspension: {
      front: { preload: '5 turns', compression: '11 clicks', rebound: '11 clicks', direction: 'out' },
      rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
    },
    alignment: null,
    enabled_modules: allMotorcycleModules,
    extra_modules: {
      geometry: {
        sag_front: '35 mm',
        sag_rear: '29 mm',
        fork_height: '4 mm showing',
        rear_ride_height: 'baseline',
        notes: 'Baseline geometry from last event.',
      },
      drivetrain: {
        front_sprocket: '15T',
        rear_sprocket: '45T',
        chain_length: '116 links',
        notes: 'Known-good gearing for MSR Cresson 1.7.',
      },
    },
    notes:
      'Neutral baseline. Stable on entry and rear drive was acceptable. Front gave good feedback through long right-handers.',
    created_at: '2026-05-18T14:10:00.000Z',
    updated_at: '2026-05-18T14:10:00.000Z',
  },
];

const demoBaselineSource = DEMO_SESSIONS.find((session) => session.id === 'demo-session-3')!;

export const DEMO_VEHICLE_BASELINES: VehicleBaseline[] = [
  {
    id: 'demo-baseline-r6',
    user_id: DEMO_USER_ID,
    vehicle_id: 'demo-r6',
    source_session_id: demoBaselineSource.id,
    source_track_id: demoBaselineSource.track_id,
    source_track_name: demoBaselineSource.track_name,
    source_date: demoBaselineSource.date,
    source_start_time: demoBaselineSource.start_time,
    source_session_number: demoBaselineSource.session_number,
    source_conditions: demoBaselineSource.conditions,
    tires: demoBaselineSource.tires,
    suspension: demoBaselineSource.suspension,
    alignment: demoBaselineSource.alignment,
    enabled_modules: demoBaselineSource.enabled_modules ?? {},
    extra_modules: demoBaselineSource.extra_modules,
    notes: demoBaselineSource.notes,
    created_at: demoBaselineSource.created_at,
    updated_at: demoBaselineSource.updated_at,
  },
];

export const DEMO_SESSION_ENVIRONMENTS: SessionEnvironment[] = [
  {
    id: 'demo-env-4',
    user_id: DEMO_USER_ID,
    session_id: 'demo-session-4',
    ambient_temperature_c: 32,
    track_temperature_c: 49,
    humidity_percent: 41,
    weather_condition: 'Clear and hot',
    surface_condition: 'Hot, greasy late session',
    source: 'manual',
    created_at: '2026-05-18T19:45:00.000Z',
    updated_at: '2026-05-18T19:45:00.000Z',
  },
  {
    id: 'demo-env-3',
    user_id: DEMO_USER_ID,
    session_id: 'demo-session-3',
    ambient_temperature_c: 27,
    track_temperature_c: 39,
    humidity_percent: 48,
    weather_condition: 'Sunny',
    surface_condition: 'Clean, more grip than morning',
    source: 'manual',
    created_at: '2026-05-18T16:55:00.000Z',
    updated_at: '2026-05-18T16:55:00.000Z',
  },
  {
    id: 'demo-env-2',
    user_id: DEMO_USER_ID,
    session_id: 'demo-session-2',
    ambient_temperature_c: 24,
    track_temperature_c: 34,
    humidity_percent: 55,
    weather_condition: 'Sunny',
    surface_condition: 'Clean and warming',
    source: 'manual',
    created_at: '2026-05-18T15:35:00.000Z',
    updated_at: '2026-05-18T15:35:00.000Z',
  },
  {
    id: 'demo-env-1',
    user_id: DEMO_USER_ID,
    session_id: 'demo-session-1',
    ambient_temperature_c: 21,
    track_temperature_c: 28,
    humidity_percent: 62,
    weather_condition: 'Clear morning',
    surface_condition: 'Clean, cool track',
    source: 'manual',
    created_at: '2026-05-18T14:10:00.000Z',
    updated_at: '2026-05-18T14:10:00.000Z',
  },
];

export const DEMO_TELEMETRY_SUMMARIES: TelemetrySummary[] = [
  {
    id: 'demo-telemetry-4',
    user_id: DEMO_USER_ID,
    session_id: 'demo-session-4',
    vehicle_id: 'demo-r6',
    source: 'demo',
    summary: 'Hotter session with rear grip fading after the early laps.',
    metrics: {
      lap_times_ms: [103920, 103640, 103880, 104510, 105120, 105380],
      lap_count: 6,
      best_lap_ms: 103640,
      average_lap_ms: 104408,
      consistency_spread_ms: 1740,
    },
    created_at: '2026-05-18T19:45:00.000Z',
    updated_at: '2026-05-18T19:45:00.000Z',
  },
  {
    id: 'demo-telemetry-3',
    user_id: DEMO_USER_ID,
    session_id: 'demo-session-3',
    vehicle_id: 'demo-r6',
    source: 'demo',
    summary: 'Best same-track signal from the day with stable pace.',
    metrics: {
      lap_times_ms: [104620, 104110, 103980, 104250, 104430, 104690],
      lap_count: 6,
      best_lap_ms: 103980,
      average_lap_ms: 104347,
      consistency_spread_ms: 710,
    },
    created_at: '2026-05-18T16:55:00.000Z',
    updated_at: '2026-05-18T16:55:00.000Z',
  },
  {
    id: 'demo-telemetry-2',
    user_id: DEMO_USER_ID,
    session_id: 'demo-session-2',
    vehicle_id: 'demo-r6',
    source: 'demo',
    summary: 'Front push made pace less consistent.',
    metrics: {
      lap_times_ms: [105800, 105220, 105430, 106010, 106440],
      lap_count: 5,
      best_lap_ms: 105220,
      average_lap_ms: 105780,
      consistency_spread_ms: 1220,
    },
    created_at: '2026-05-18T15:35:00.000Z',
    updated_at: '2026-05-18T15:35:00.000Z',
  },
  {
    id: 'demo-telemetry-1',
    user_id: DEMO_USER_ID,
    session_id: 'demo-session-1',
    vehicle_id: 'demo-r6',
    source: 'demo',
    summary: 'Baseline pace on a cooler morning track.',
    metrics: {
      lap_times_ms: [105120, 104740, 104860, 105020, 105310],
      lap_count: 5,
      best_lap_ms: 104740,
      average_lap_ms: 105010,
      consistency_spread_ms: 570,
    },
    created_at: '2026-05-18T14:10:00.000Z',
    updated_at: '2026-05-18T14:10:00.000Z',
  },
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function getDemoProfile(): Profile {
  return clone(DEMO_PROFILE);
}

export function getDemoVehicles(): Vehicle[] {
  return DEMO_VEHICLES.map(clone);
}

export function getDemoTracks(): Track[] {
  return [...DEMO_TRACKS].sort((a, b) => a.name.localeCompare(b.name)).map(clone);
}

export function getDemoSessions(vehicleId?: string, limit?: number): Session[] {
  const sessions = DEMO_SESSIONS
    .filter((session) => !vehicleId || session.vehicle_id === vehicleId)
    .sort(compareSessionsDesc)
    .map(clone);

  return typeof limit === 'number' ? sessions.slice(0, limit) : sessions;
}

export function getDemoSession(id: string): Session | null {
  const session = DEMO_SESSIONS.find((demoSession) => demoSession.id === id);
  return session ? clone(session) : null;
}

export function getDemoSessionCount(vehicleId?: string): number {
  return getDemoSessions(vehicleId).length;
}

export function getDemoPreviousSession(currentSession: Session): Session | null {
  return (
    DEMO_SESSIONS
      .filter((session) => session.vehicle_id === currentSession.vehicle_id && session.id !== currentSession.id)
      .filter((session) => isSessionBefore(session, currentSession))
      .sort(compareSessionsDesc)
      .map(clone)[0] ?? null
  );
}

export function getDemoComparableSessions(currentSession: Session): Session[] {
  return DEMO_SESSIONS
    .filter((session) => session.vehicle_id === currentSession.vehicle_id && session.id !== currentSession.id)
    .sort((a, b) => {
      const aSameTrack = sessionsMatchTrack(a, currentSession);
      const bSameTrack = sessionsMatchTrack(b, currentSession);
      if (aSameTrack !== bSameTrack) return aSameTrack ? -1 : 1;
      return compareSessionsDesc(a, b);
    })
    .map(clone);
}

export function getDemoVehicleBaseline(vehicleId: string): VehicleBaseline | null {
  const baseline = DEMO_VEHICLE_BASELINES.find((demoBaseline) => demoBaseline.vehicle_id === vehicleId);
  return baseline ? clone(baseline) : null;
}

export function getDemoVehicleBaselines(vehicleIds: string[]): VehicleBaseline[] {
  const idSet = new Set(vehicleIds);
  return DEMO_VEHICLE_BASELINES.filter((baseline) => idSet.has(baseline.vehicle_id)).map(clone);
}

export function getDemoSessionEnvironment(sessionId: string): SessionEnvironment | null {
  const environment = DEMO_SESSION_ENVIRONMENTS.find((demoEnvironment) => demoEnvironment.session_id === sessionId);
  return environment ? clone(environment) : null;
}

export function getDemoSessionEnvironments(sessionIds: string[]): SessionEnvironment[] {
  const idSet = new Set(sessionIds);
  return DEMO_SESSION_ENVIRONMENTS.filter((environment) => idSet.has(environment.session_id)).map(clone);
}

export function getDemoTelemetrySummaries(sessionIds: string[]): TelemetrySummary[] {
  const idSet = new Set(sessionIds);
  return DEMO_TELEMETRY_SUMMARIES.filter((summary) => idSet.has(summary.session_id)).map(clone);
}

export function getDemoLatestSessionsByVehicle(): Record<string, Session> {
  const latest: Record<string, Session> = {};
  for (const session of getDemoSessions()) {
    if (!latest[session.vehicle_id]) {
      latest[session.vehicle_id] = session;
    }
  }
  return latest;
}
