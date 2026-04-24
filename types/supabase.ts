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
export type EnvironmentSource = 'manual' | 'forecast' | 'telemetry';
export type FeedbackOutcome = 'better' | 'same' | 'worse' | 'unknown';
export type RecommendationStatus = 'proposed' | 'applied' | 'rejected' | 'superseded';
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

export type AdviceDataUsed = {
  manual: boolean;
  weather: boolean;
  history: boolean;
  feedback: boolean;
  telemetry: boolean;
};

export type TelemetryMetrics = {
  tire_pressure_start?: Json;
  tire_pressure_end?: Json;
  tire_pressure_delta?: Json;
  suspension_travel?: Json;
  lap_count?: number;
  best_lap_ms?: number;
  ambient_temperature_trend_c?: Json;
  track_temperature_trend_c?: Json;
  [key: string]: Json | undefined;
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
      session_environment: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          ambient_temperature_c: number | null;
          track_temperature_c: number | null;
          humidity_percent: number | null;
          weather_condition: string | null;
          surface_condition: string | null;
          source: EnvironmentSource;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id: string;
          ambient_temperature_c?: number | null;
          track_temperature_c?: number | null;
          humidity_percent?: number | null;
          weather_condition?: string | null;
          surface_condition?: string | null;
          source?: EnvironmentSource;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string;
          ambient_temperature_c?: number | null;
          track_temperature_c?: number | null;
          humidity_percent?: number | null;
          weather_condition?: string | null;
          surface_condition?: string | null;
          source?: EnvironmentSource;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_requests: {
        Row: {
          id: string;
          user_id: string;
          session_id: string | null;
          request_id: string;
          status: string;
          model: string | null;
          prompt_tokens: number | null;
          completion_tokens: number | null;
          latency_ms: number | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id?: string | null;
          request_id: string;
          status: string;
          model?: string | null;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          latency_ms?: number | null;
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string | null;
          request_id?: string;
          status?: string;
          model?: string | null;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          latency_ms?: number | null;
          error_message?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      ai_recommendations: {
        Row: {
          id: string;
          user_id: string;
          session_id: string | null;
          vehicle_id: string;
          track_id: string | null;
          request_id: string;
          summary: string;
          component: string | null;
          direction: string | null;
          magnitude: string | null;
          predicted_effect: string | null;
          status: RecommendationStatus;
          advice: Json;
          context_snapshot: Json;
          outcome_session_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id?: string | null;
          vehicle_id: string;
          track_id?: string | null;
          request_id: string;
          summary: string;
          component?: string | null;
          direction?: string | null;
          magnitude?: string | null;
          predicted_effect?: string | null;
          status?: RecommendationStatus;
          advice?: Json;
          context_snapshot?: Json;
          outcome_session_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string | null;
          vehicle_id?: string;
          track_id?: string | null;
          request_id?: string;
          summary?: string;
          component?: string | null;
          direction?: string | null;
          magnitude?: string | null;
          predicted_effect?: string | null;
          status?: RecommendationStatus;
          advice?: Json;
          context_snapshot?: Json;
          outcome_session_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      session_feedback: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          vehicle_id: string;
          track_id: string | null;
          recommendation_id: string | null;
          outcome: FeedbackOutcome;
          rider_confidence: number | null;
          symptoms: string[];
          notes: string | null;
          lap_time_delta_ms: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id: string;
          vehicle_id: string;
          track_id?: string | null;
          recommendation_id?: string | null;
          outcome: FeedbackOutcome;
          rider_confidence?: number | null;
          symptoms?: string[];
          notes?: string | null;
          lap_time_delta_ms?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string;
          vehicle_id?: string;
          track_id?: string | null;
          recommendation_id?: string | null;
          outcome?: FeedbackOutcome;
          rider_confidence?: number | null;
          symptoms?: string[];
          notes?: string | null;
          lap_time_delta_ms?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      race_engineer_memory: {
        Row: {
          id: string;
          user_id: string;
          vehicle_id: string;
          track_id: string | null;
          summary: string;
          patterns: Json;
          evidence_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          vehicle_id: string;
          track_id?: string | null;
          summary?: string;
          patterns?: Json;
          evidence_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          vehicle_id?: string;
          track_id?: string | null;
          summary?: string;
          patterns?: Json;
          evidence_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      telemetry_summaries: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          vehicle_id: string;
          source: string;
          summary: string | null;
          metrics: TelemetryMetrics;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id: string;
          vehicle_id: string;
          source?: string;
          summary?: string | null;
          metrics?: TelemetryMetrics;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string;
          vehicle_id?: string;
          source?: string;
          summary?: string | null;
          metrics?: TelemetryMetrics;
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
    Functions: {
      record_race_engineer_memory_feedback: {
        Args: {
          p_user_id: string;
          p_vehicle_id: string;
          p_track_id: string | null;
          p_session_id: string;
          p_track_name: string | null;
          p_session_date: string;
          p_outcome: FeedbackOutcome;
          p_symptoms: string[];
          p_notes: string | null;
        };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TableInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TableUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
