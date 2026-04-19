export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Tier = 'free' | 'pro';
export type VehicleType = 'motorcycle' | 'car';
export type SessionCondition = 'sunny' | 'overcast' | 'rainy' | 'mixed';
export type TireCondition = 'new' | 'scrubbed' | 'used' | 'worn';
export type SuspensionDirection = 'in' | 'out';
export type SuspensionEnd = {
  preload: string;
  compression: string;
  rebound: string;
  direction: SuspensionDirection;
};
export type TireEnd = {
  brand: string;
  compound: string;
  pressure: string;
};
export type Tires = {
  front: TireEnd;
  rear: TireEnd;
  condition: TireCondition;
};
export type Suspension = {
  front: SuspensionEnd;
  rear: SuspensionEnd;
};
export type Alignment = {
  front_camber: string;
  rear_camber: string;
  front_toe: string;
  rear_toe: string;
  caster: string;
};
export type GeometryModule = {
  sag_front?: string;
  sag_rear?: string;
  fork_height?: string;
  rear_ride_height?: string;
  notes?: string;
};
export type DrivetrainModule = {
  front_sprocket?: string;
  rear_sprocket?: string;
  chain_length?: string;
  notes?: string;
};
export type AeroModule = {
  wing_angle?: string;
  splitter_setting?: string;
  rake?: string;
  notes?: string;
};
export type ExtraModules = {
  geometry?: GeometryModule;
  drivetrain?: DrivetrainModule;
  aero?: AeroModule;
};
export type SessionModuleKey =
  | 'tires'
  | 'suspension'
  | 'alignment'
  | 'geometry'
  | 'drivetrain'
  | 'aero'
  | 'notes';
export type SessionEnabledModules = Record<SessionModuleKey, boolean>;
export type SessionAdvancedVisibility = {
  tires: boolean;
  suspension: boolean;
  alignment: boolean;
  geometry: boolean;
  drivetrain: boolean;
  aero: boolean;
  notes: boolean;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          tier: Tier;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_price_id: string | null;
          stripe_current_period_end: string | null;
        };
        Insert: {
          id: string;
          tier?: Tier;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          stripe_price_id?: string | null;
          stripe_current_period_end?: string | null;
        };
        Update: {
          id?: string;
          tier?: Tier;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          stripe_price_id?: string | null;
          stripe_current_period_end?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      vehicles: {
        Row: {
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
        };
        Insert: {
          id?: string;
          user_id: string;
          nickname: string;
          type: VehicleType;
          year?: number | null;
          make?: string | null;
          model?: string | null;
          photo_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          nickname?: string;
          type?: VehicleType;
          year?: number | null;
          make?: string | null;
          model?: string | null;
          photo_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tracks: {
        Row: {
          id: string;
          name: string;
          location: string | null;
          is_seeded: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          location?: string | null;
          is_seeded?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          location?: string | null;
          is_seeded?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          user_id: string;
          vehicle_id: string;
          track_id: string | null;
          track_name: string | null;
          date: string;
          start_time: string | null;
          session_number: number | null;
          conditions: SessionCondition;
          tires: Tires;
          suspension: Suspension;
          alignment: Alignment | null;
          enabled_modules: SessionEnabledModules | null;
          extra_modules: ExtraModules | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          vehicle_id: string;
          track_id?: string | null;
          track_name?: string | null;
          date: string;
          start_time?: string | null;
          session_number?: number | null;
          conditions: SessionCondition;
          tires: Tires;
          suspension: Suspension;
          alignment?: Alignment | null;
          enabled_modules?: SessionEnabledModules | null;
          extra_modules?: ExtraModules | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          vehicle_id?: string;
          track_id?: string | null;
          track_name?: string | null;
          date?: string;
          start_time?: string | null;
          session_number?: number | null;
          conditions?: SessionCondition;
          tires?: Tires;
          suspension?: Suspension;
          alignment?: Alignment | null;
          enabled_modules?: SessionEnabledModules | null;
          extra_modules?: ExtraModules | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sag_entries: {
        Row: {
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
        };
        Insert: {
          id?: string;
          user_id: string;
          created_at?: string;
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
        };
        Update: {
          id?: string;
          user_id?: string;
          created_at?: string;
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
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TableInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TableUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
