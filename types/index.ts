import type {
  AeroModule,
  Alignment,
  DrivetrainModule,
  EnvironmentSource,
  ExtraModules,
  FeedbackOutcome,
  GeometryModule,
  Json,
  RecommendationStatus,
  SessionAdvancedVisibility,
  SessionCondition,
  SessionEnabledModules,
  SessionModuleKey,
  Suspension,
  SuspensionDirection,
  SuspensionEnd,
  Tier,
  TireCondition,
  TireEnd,
  Tires,
  TelemetryMetrics,
  VehicleType,
  Tables,
} from '@/types/supabase';

export type {
  AeroModule,
  Alignment,
  DrivetrainModule,
  EnvironmentSource,
  ExtraModules,
  FeedbackOutcome,
  GeometryModule,
  Json,
  RecommendationStatus,
  SessionAdvancedVisibility,
  SessionCondition,
  SessionEnabledModules,
  SessionModuleKey,
  Suspension,
  SuspensionDirection,
  SuspensionEnd,
  Tier,
  TireCondition,
  TireEnd,
  Tires,
  TelemetryMetrics,
  VehicleType,
};

export type Profile = Tables<'profiles'>;
export type Vehicle = Tables<'vehicles'>;
export type Track = Tables<'tracks'>;
export type Session = Tables<'sessions'>;
export type SessionEnvironment = Tables<'session_environment'>;
export type AiRecommendation = Tables<'ai_recommendations'>;
export type SessionFeedback = Tables<'session_feedback'>;
export type RaceEngineerMemory = Tables<'race_engineer_memory'>;
export type TelemetrySummary = Tables<'telemetry_summaries'>;
export type SagEntry = Tables<'sag_entries'>;

export interface CreateVehicleInput {
  nickname: string;
  type: VehicleType;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  photo_url?: string | null;
}

export interface UpdateVehicleInput {
  nickname?: string;
  type?: VehicleType;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  photo_url?: string | null;
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface CreateSessionInput {
  vehicle_id: string;
  track_id: string | null;
  track_name: string | null;
  date: string;
  start_time?: string | null;
  session_number?: number | null;
  conditions: SessionCondition;
  tires: Tires;
  suspension: Suspension;
  alignment: Alignment | null;
  enabled_modules?: SessionEnabledModules | null;
  extra_modules?: ExtraModules | null;
  environment?: CreateSessionEnvironmentInput | null;
  notes?: string | null;
}

export interface CreateSessionEnvironmentInput {
  ambient_temperature_c?: number | null;
  track_temperature_c?: number | null;
  humidity_percent?: number | null;
  weather_condition?: string | null;
  surface_condition?: string | null;
  source?: EnvironmentSource;
}

export interface CreateSagEntryInput {
  label?: string | null;
  notes?: string | null;
  front_l0?: number | null;
  front_l1?: number | null;
  front_l2?: number | null;
  rear_l0?: number | null;
  rear_l1?: number | null;
  rear_l2?: number | null;
  front_travel_mm?: number | null;
  rear_travel_mm?: number | null;
}
