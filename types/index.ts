export type Tier = 'free' | 'pro';
export type VehicleType = 'motorcycle' | 'car';

export interface Profile {
  id: string;
  tier: Tier;
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: string;
  user_id: string;
  nickname: string;
  type: VehicleType;
  year: number | null;
  make: string | null;
  model: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface Track {
  id: string;
  name: string;
  location: string | null;
  is_seeded: boolean;
  created_by: string | null;
  created_at: string;
}

export type TireCondition = 'new' | 'scrubbed' | 'used' | 'worn';

export interface TireEnd { brand: string; compound: string; pressure: string; }
export interface Tires { front: TireEnd; rear: TireEnd; condition: TireCondition; }

export type SuspensionDirection = 'in' | 'out';
export interface SuspensionEnd { preload: string; compression: string; rebound: string; direction: SuspensionDirection; }
export interface Suspension { front: SuspensionEnd; rear: SuspensionEnd; }

export interface Alignment {
  front_camber: string; rear_camber: string;
  front_toe: string;    rear_toe: string;
  caster: string;
}

export type SessionCondition = 'sunny' | 'overcast' | 'rainy' | 'mixed';

export interface GeometryModule {
  sag_front?: string;
  sag_rear?: string;
  fork_height?: string;
  rear_ride_height?: string;
  notes?: string;
}

export interface DrivetrainModule {
  front_sprocket?: string;
  rear_sprocket?: string;
  chain_length?: string;
  notes?: string;
}

export interface AeroModule {
  wing_angle?: string;
  splitter_setting?: string;
  rake?: string;
  notes?: string;
}

export interface ExtraModules {
  geometry?: GeometryModule;
  drivetrain?: DrivetrainModule;
  aero?: AeroModule;
}

export interface Session {
  id: string; user_id: string; vehicle_id: string;
  track_id: string | null; track_name: string | null;
  date: string; start_time: string | null; conditions: SessionCondition;
  tires: Tires; suspension: Suspension; alignment: Alignment | null;
  extra_modules: ExtraModules | null;
  notes: string | null; created_at: string; updated_at: string;
}

export interface CreateSessionInput {
  vehicle_id: string;
  track_id: string | null;
  track_name: string | null;
  date: string;
  start_time?: string | null;
  conditions: SessionCondition;
  tires: Tires;
  suspension: Suspension;
  alignment: Alignment | null;
  extra_modules?: ExtraModules | null;
  notes?: string | null;
}

export interface SagEntry {
  id: string;
  user_id: string;
  created_at: string;
  label: string | null;
  notes: string | null;
  front_l0: number | null;
  front_l1: number | null;
  front_l2: number | null;
  rear_l0: number | null;
  rear_l1: number | null;
  rear_l2: number | null;
  front_travel_mm: number | null;
  rear_travel_mm: number | null;
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
