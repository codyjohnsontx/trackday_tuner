import type {
  AeroModule,
  Alignment,
  DrivetrainModule,
  ExtraModules,
  GeometryModule,
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
  VehicleType,
  Tables,
} from '@/types/supabase';

export type {
  AeroModule,
  Alignment,
  DrivetrainModule,
  ExtraModules,
  GeometryModule,
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
  VehicleType,
};

export type Profile = Tables<'profiles'>;
export type Vehicle = Tables<'vehicles'>;
export type Track = Tables<'tracks'>;
export type Session = Tables<'sessions'>;
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
  notes?: string | null;
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
