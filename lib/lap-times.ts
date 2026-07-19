import type { CreateSessionLapInput } from '@/types';

export const MIN_LAP_TIME_MS = 10_000;
export const MAX_LAP_TIME_MS = 1_200_000;
export const MAX_SESSION_LAPS = 200;

export interface ParsedLapLine {
  line: number;
  lap: CreateSessionLapInput | null;
  error: string | null;
}

export interface LapAggregate {
  lap_count: number;
  best_lap_ms: number | null;
  average_lap_ms: number | null;
  consistency_spread_ms: number | null;
  lap_times_ms: number[];
}

export function parseLapTime(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const minuteMatch = normalized.match(/^(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    const seconds = Number(minuteMatch[2]);
    if (seconds >= 60) return null;
    const milliseconds = Number((minuteMatch[3] ?? '').padEnd(3, '0'));
    const total = (minutes * 60 + seconds) * 1000 + milliseconds;
    return total >= MIN_LAP_TIME_MS && total <= MAX_LAP_TIME_MS ? total : null;
  }

  const secondsMatch = normalized.match(/^(\d{1,4})(?:\.(\d{1,3}))?$/);
  if (!secondsMatch) return null;
  const seconds = Number(secondsMatch[1]);
  const milliseconds = Number((secondsMatch[2] ?? '').padEnd(3, '0'));
  const total = seconds * 1000 + milliseconds;
  return total >= MIN_LAP_TIME_MS && total <= MAX_LAP_TIME_MS ? total : null;
}

export function parseLapList(value: string): ParsedLapLine[] {
  const chunks = value
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (chunks.length > MAX_SESSION_LAPS) {
    return [{ line: 1, lap: null, error: `Lap lists cannot exceed ${MAX_SESSION_LAPS} entries.` }];
  }

  const usedNumbers = new Set<number>();
  let nextNumber = 1;

  return chunks.map((chunk, index) => {
    const explicit = chunk.match(/^lap\s+(\d{1,3})\s*[:=-]\s*(.+)$/i);
    const lapNumber = explicit ? Number(explicit[1]) : nextNumber;
    const timeText = explicit ? explicit[2] : chunk;
    nextNumber = Math.max(nextNumber + 1, lapNumber + 1);

    if (!Number.isInteger(lapNumber) || lapNumber < 1 || lapNumber > 500) {
      return { line: index + 1, lap: null, error: `Line ${index + 1}: lap number must be 1–500.` };
    }
    if (usedNumbers.has(lapNumber)) {
      return { line: index + 1, lap: null, error: `Line ${index + 1}: lap ${lapNumber} is duplicated.` };
    }

    const lapTimeMs = parseLapTime(timeText);
    if (lapTimeMs === null) {
      return { line: index + 1, lap: null, error: `Line ${index + 1}: use M:SS.mmm or total seconds.` };
    }

    usedNumbers.add(lapNumber);
    return {
      line: index + 1,
      lap: { lap_number: lapNumber, lap_time_ms: lapTimeMs, included: true },
      error: null,
    };
  });
}

export function validateLaps(laps: CreateSessionLapInput[]): string | null {
  if (laps.length > MAX_SESSION_LAPS) return `Sessions cannot exceed ${MAX_SESSION_LAPS} laps.`;
  const numbers = new Set<number>();
  for (const lap of laps) {
    if (!Number.isInteger(lap.lap_number) || lap.lap_number < 1 || lap.lap_number > 500) {
      return 'Lap numbers must be integers from 1 to 500.';
    }
    if (!Number.isInteger(lap.lap_time_ms) || lap.lap_time_ms < MIN_LAP_TIME_MS || lap.lap_time_ms > MAX_LAP_TIME_MS) {
      return 'Lap times must be between 10 seconds and 20 minutes.';
    }
    if (numbers.has(lap.lap_number)) return `Lap ${lap.lap_number} is duplicated.`;
    numbers.add(lap.lap_number);
  }
  return null;
}

export function aggregateLaps(laps: CreateSessionLapInput[]): LapAggregate {
  const times = laps.filter((lap) => lap.included).map((lap) => lap.lap_time_ms);
  if (times.length === 0) {
    return { lap_count: 0, best_lap_ms: null, average_lap_ms: null, consistency_spread_ms: null, lap_times_ms: [] };
  }
  return {
    lap_count: times.length,
    best_lap_ms: Math.min(...times),
    average_lap_ms: Math.round(times.reduce((sum, value) => sum + value, 0) / times.length),
    consistency_spread_ms: Math.max(...times) - Math.min(...times),
    lap_times_ms: times,
  };
}

export function formatLapTimeInput(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
