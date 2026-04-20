import type { RetrievedChunk } from '@/lib/rag/types';
import type { Session, Vehicle } from '@/types';

export const SYSTEM_PROMPT = `You are Race Engineer, the rider's or driver's personal post-session race engineer for trackday motorcycles and cars. Speak like a seasoned, level-headed race engineer: direct, specific, and conservative.

Rules you must always follow:
1. Suggest AT MOST one primary change. You may add one secondary check, but never more.
2. Keep adjustments small and reversible (for example: 0.5 psi, 1-2 damper clicks, 2-3 mm fork height, 0.5 degree camber).
3. Always advise the rider or driver to change one thing at a time and re-test for a full session.
4. Base every recommendation on the session data or retrieved knowledge snippets supplied below. Cite the snippet \`source\` for every recommendation that uses it.
5. If the session data is insufficient, the symptom points to a mechanical fault, or the question is outside trackday setup, REFUSE by returning an empty \`recommended_changes\` array and an explanation in the \`refusal\` field.
6. Never recommend anything that requires removing safety equipment, disabling safety systems, or operating outside manufacturer service limits.
7. Always include standard safety notes in every response, even successful ones:
   - "This is informational only. You are responsible for vehicle safety and on-track conduct."
   - "Make one change at a time and re-test for a full session before stacking another change."
8. Output strictly matches the AdviceResponse JSON schema. Do not add keys.

Confidence levels:
- "low": limited session data or conflicting symptoms; user should treat as a hypothesis.
- "medium": session data is consistent with the reported symptom and at least one knowledge source supports the suggestion.
- "high": session data strongly matches a well-documented pattern in the retrieved knowledge.`;

export const DISCLAIMER_NOTE =
  'This is informational only. You are responsible for vehicle safety and on-track conduct.';
export const ONE_CHANGE_NOTE =
  'Make one change at a time and re-test for a full session before stacking another change.';

export interface BuildPromptInput {
  session: Session;
  previousSession: Session | null;
  vehicle: Vehicle;
  question: string;
  symptoms?: string[] | null;
  changeIntent?: string | null;
  temperatureC?: number | null;
  retrieved: RetrievedChunk[];
}

function formatValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const trimmed = value.trim();
  return trimmed === '' ? '—' : trimmed;
}

function formatSessionBlock(label: string, session: Session | null): string {
  if (!session) {
    return `${label}:\n  (none)`;
  }
  const lines: string[] = [];
  lines.push(`${label}:`);
  lines.push(`  date: ${session.date}`);
  lines.push(`  track: ${formatValue(session.track_name)}`);
  lines.push(`  conditions: ${session.conditions}`);
  if (session.session_number != null) {
    lines.push(`  session_number: ${session.session_number}`);
  }
  lines.push(`  tires.condition: ${formatValue(session.tires.condition)}`);
  lines.push(`  tires.front: brand=${formatValue(session.tires.front.brand)} compound=${formatValue(session.tires.front.compound)} pressure=${formatValue(session.tires.front.pressure)}`);
  lines.push(`  tires.rear: brand=${formatValue(session.tires.rear.brand)} compound=${formatValue(session.tires.rear.compound)} pressure=${formatValue(session.tires.rear.pressure)}`);
  lines.push(`  suspension.front: preload=${formatValue(session.suspension.front.preload)} compression=${formatValue(session.suspension.front.compression)} rebound=${formatValue(session.suspension.front.rebound)} direction=${session.suspension.front.direction}`);
  lines.push(`  suspension.rear: preload=${formatValue(session.suspension.rear.preload)} compression=${formatValue(session.suspension.rear.compression)} rebound=${formatValue(session.suspension.rear.rebound)} direction=${session.suspension.rear.direction}`);
  if (session.alignment) {
    lines.push(
      `  alignment: front_camber=${formatValue(session.alignment.front_camber)} rear_camber=${formatValue(session.alignment.rear_camber)} front_toe=${formatValue(session.alignment.front_toe)} rear_toe=${formatValue(session.alignment.rear_toe)} caster=${formatValue(session.alignment.caster)}`,
    );
  }
  const extra = session.extra_modules;
  if (extra?.geometry) {
    lines.push(
      `  geometry: sag_front=${formatValue(extra.geometry.sag_front)} sag_rear=${formatValue(extra.geometry.sag_rear)} fork_height=${formatValue(extra.geometry.fork_height)} rear_ride_height=${formatValue(extra.geometry.rear_ride_height)}`,
    );
  }
  if (extra?.drivetrain) {
    lines.push(
      `  drivetrain: front_sprocket=${formatValue(extra.drivetrain.front_sprocket)} rear_sprocket=${formatValue(extra.drivetrain.rear_sprocket)} chain_length=${formatValue(extra.drivetrain.chain_length)}`,
    );
  }
  if (extra?.aero) {
    lines.push(
      `  aero: wing_angle=${formatValue(extra.aero.wing_angle)} splitter=${formatValue(extra.aero.splitter_setting)} rake=${formatValue(extra.aero.rake)}`,
    );
  }
  if (session.notes) {
    lines.push(`  notes: ${session.notes.trim()}`);
  }
  return lines.join('\n');
}

function formatVehicleBlock(vehicle: Vehicle): string {
  const parts = [
    `type: ${vehicle.type}`,
    `nickname: ${vehicle.nickname}`,
    vehicle.year ? `year: ${vehicle.year}` : null,
    vehicle.make ? `make: ${vehicle.make}` : null,
    vehicle.model ? `model: ${vehicle.model}` : null,
  ].filter(Boolean);
  return `Vehicle:\n  ${parts.join('\n  ')}`;
}

const EXCERPT_MAX_CHARS = 800;

function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const boundary = Math.max(
    window.lastIndexOf(' '),
    window.lastIndexOf('\n'),
    window.lastIndexOf('.'),
    window.lastIndexOf(','),
    window.lastIndexOf(';'),
  );
  const cut = boundary > max * 0.6 ? window.slice(0, boundary).trimEnd() : window.trimEnd();
  return `${cut}\u2026`;
}

function formatRetrievedBlock(retrieved: RetrievedChunk[]): string {
  if (retrieved.length === 0) {
    return 'Knowledge snippets:\n  (none matched the query)';
  }
  const lines: string[] = ['Knowledge snippets:'];
  retrieved.forEach(({ chunk, score }, idx) => {
    lines.push(
      `  [${idx + 1}] source=${chunk.source} heading="${chunk.heading}" vehicle=${chunk.vehicle_type} score=${score.toFixed(3)}`,
    );
    const excerpt = truncateAtWordBoundary(chunk.text, EXCERPT_MAX_CHARS);
    lines.push(excerpt.split('\n').map((line) => `      ${line}`).join('\n'));
  });
  return lines.join('\n');
}

function formatMetaBlock(input: BuildPromptInput): string {
  const symptomLine = input.symptoms && input.symptoms.length > 0
    ? input.symptoms.join(', ')
    : '(none reported)';
  const intentLine = input.changeIntent?.trim() || '(not specified)';
  const tempLine = input.temperatureC != null ? `${input.temperatureC} C` : '(not reported)';
  return [
    `Question: ${input.question.trim()}`,
    `Reported symptoms: ${symptomLine}`,
    `Change intent: ${intentLine}`,
    `Ambient temperature: ${tempLine}`,
  ].join('\n');
}

export function buildUserPrompt(input: BuildPromptInput): string {
  return [
    formatMetaBlock(input),
    '',
    formatVehicleBlock(input.vehicle),
    '',
    formatSessionBlock('Current session', input.session),
    '',
    formatSessionBlock('Previous session', input.previousSession),
    '',
    formatRetrievedBlock(input.retrieved),
    '',
    'Instructions:',
    '- Diagnose the likely cause using the current session first, then the previous session, then the retrieved snippets.',
    '- If you cannot identify a safe, small, supported change, return an empty recommended_changes array and set the refusal field.',
    '- Every citation.source must match one of the knowledge snippet sources listed above.',
    `- Always include the following safety notes verbatim: "${DISCLAIMER_NOTE}" and "${ONE_CHANGE_NOTE}".`,
  ].join('\n');
}

export function buildMessages(input: BuildPromptInput) {
  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(input) },
  ];
}
