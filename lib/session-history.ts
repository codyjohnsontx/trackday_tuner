import { setupField, setupFieldsOf } from '@/lib/stored-session';
import { formatTemperature, type TemperatureUnit } from '@/lib/temperature';
import type { Session, SessionEnvironment } from '@/types';
import { truncateAtWordBoundary } from '@/lib/utils';

const conditionLabel: Record<string, string> = {
  sunny: 'Sunny',
  overcast: 'Overcast',
  rainy: 'Rainy',
  mixed: 'Mixed',
};

const NOTES_PREVIEW_LIMIT = 140;

export function formatSessionDateLabel(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatSessionTimeLabel(time: string | null): string {
  if (!time) return '';
  const parts = time.split(':');
  if (parts.length < 2) return '';
  const [h, m] = parts.map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function getConditionLabel(condition: string): string {
  return conditionLabel[condition] ?? condition;
}

export function getNotesPreview(notes: string | null | undefined): string | null {
  const trimmed = notes?.trim();
  if (!trimmed) return null;
  return truncateAtWordBoundary(trimmed, NOTES_PREVIEW_LIMIT);
}

const TIRE_SUMMARY_ROWS = [
  { label: 'Front Tire', field: setupField('tires.front.pressure') },
  { label: 'Rear Tire', field: setupField('tires.rear.pressure') },
];

const SUSPENSION_SUMMARY_ROWS = (['front', 'rear'] as const).map((end) => ({
  label: end === 'front' ? 'Front Susp.' : 'Rear Susp.',
  fields: setupFieldsOf('suspension').filter(
    (field) => field.kind === 'value' && field.id.startsWith(`suspension.${end}.`),
  ),
}));

export interface SessionHistorySummary {
  conditionLabel: string;
  dateLabel: string;
  timeLabel: string;
  notesPreview: string | null;
  environmentRows: Array<{ label: string; value: string }>;
  tireRows: Array<{ label: string; value: string }>;
  suspensionRows: Array<{ label: string; value: string }>;
}

export function buildSessionHistorySummary(
  session: Session,
  environment?: SessionEnvironment | null,
  /** The unit the rider reads in; readings are stored in Celsius regardless. */
  temperatureUnit: TemperatureUnit = 'c',
): SessionHistorySummary {
  const environmentRows: Array<{ label: string; value: string }> = [];
  if (environment?.ambient_temperature_c != null) {
    environmentRows.push({
      label: 'Ambient',
      value: formatTemperature(environment.ambient_temperature_c, temperatureUnit),
    });
  }
  if (environment?.track_temperature_c != null) {
    environmentRows.push({
      label: 'Track',
      value: formatTemperature(environment.track_temperature_c, temperatureUnit),
    });
  }
  if (environment?.humidity_percent != null) {
    environmentRows.push({ label: 'Humidity', value: `${environment.humidity_percent}%` });
  }
  if (environment?.weather_condition?.trim()) {
    environmentRows.push({ label: 'Weather', value: environment.weather_condition.trim() });
  }
  if (environment?.surface_condition?.trim()) {
    environmentRows.push({ label: 'Surface', value: environment.surface_condition.trim() });
  }

  const tireRows = TIRE_SUMMARY_ROWS.map(({ label, field }) => ({
    label,
    value: field.read(session)?.trim() || 'Not logged',
  }));

  const suspensionRows = SUSPENSION_SUMMARY_ROWS.map(({ label, fields }) => ({
    label,
    value:
      fields
        .map((field) => field.read(session) ?? '')
        .filter((value) => value.trim())
        .join(' / ') || 'Not logged',
  }));

  return {
    conditionLabel: getConditionLabel(session.conditions),
    dateLabel: formatSessionDateLabel(session.date),
    timeLabel: formatSessionTimeLabel(session.start_time),
    notesPreview: getNotesPreview(session.notes),
    environmentRows,
    tireRows,
    suspensionRows,
  };
}
