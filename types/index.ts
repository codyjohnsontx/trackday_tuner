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
  created_at: string;
  updated_at: string;
}

export interface CreateVehicleInput {
  nickname: string;
  type: VehicleType;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
