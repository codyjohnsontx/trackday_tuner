export declare const GATE_TARGETS: {
  acceptedRiders: number;
  ridersWithLoop: number;
  ridersWithRepeatLoops: number;
  comparisonUsefulness: number;
  veryDisappointedPct: number;
};

export declare const AI_SUCCESS_STATUSES: Set<string>;

export interface LoopSessionRow {
  id: string;
  user_id: string;
  date: string;
  start_time?: string | null;
  created_at?: string | null;
}

export interface LoopChangeRow {
  user_id: string;
  session_id: string;
  changes: unknown[] | null;
}

export interface LoopOutcomeRow {
  user_id: string;
  session_id: string;
  reference_session_id?: string | null;
}

export declare function computeWithinDayLoops(input: {
  sessions: LoopSessionRow[] | null | undefined;
  changes: LoopChangeRow[] | null | undefined;
  outcomes: LoopOutcomeRow[] | null | undefined;
  riderIds?: Set<string> | null;
}): {
  loopsByRider: Map<string, number>;
  ridersWithLoop: number;
  ridersWithRepeatLoops: number;
  totalLoops: number;
};

export interface ComparisonEventRow {
  user_id: string;
  event_name: string;
  properties?: Record<string, unknown> | null;
}

export declare function summarizeComparisonUsage(
  events: ComparisonEventRow[] | null | undefined,
  riderIds?: Set<string> | null,
): { total: number; bySurface: Map<string, number> };

export interface AiRequestRow {
  user_id: string;
  status: string;
}

export declare function summarizeAiGuidance(input: {
  aiRequests: AiRequestRow[] | null | undefined;
  outcomes: Array<{ user_id: string }> | null | undefined;
  riderIds?: Set<string> | null;
}): {
  guidedRiders: number;
  unguidedRiders: number;
  guidedOutcomes: number;
  unguidedOutcomes: number;
  guidedOutcomeAvg: number | null;
  unguidedOutcomeAvg: number | null;
};

export declare function decideGate(input: {
  acceptedRiders: number;
  ridersWithLoop: number;
  ridersWithRepeatLoops: number;
  comparisonUsefulness: number | string;
  veryDisappointedPct: number;
}): boolean;
