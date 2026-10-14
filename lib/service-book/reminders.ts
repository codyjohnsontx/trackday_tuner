import type { DistanceUnit } from '@/types/supabase';
import { formatDay, isIsoDate } from '@/lib/service-book/calendar';
import {
  computeDue,
  type DueEntry,
  type DueEntryItem,
  type DueInput,
  type DueItem,
  type DueOverride,
  type ItemDue,
  type ItemDueStatus,
} from '@/lib/service-book/due';
import { formatDistance, formatHours } from '@/lib/service-book/format';
import {
  compareSessionsAsc,
  type UsageBook,
  type UsageLap,
  type UsageReading,
  type UsageSession,
  type UsageWeight,
} from '@/lib/service-book/usage';

/**
 * The in-app reminders (owner, Q8 and PQ1: badges on the dashboard and each
 * garage bike, and a nudge right after a session that pushes an item past due;
 * email waits for a domain). Everything here is derived on read from the same
 * rows the book screen reads, so a chip, the banner and the schedule cannot
 * disagree about what is due.
 *
 * THE RIDER DECIDES WHAT A DAY COUNTS FOR (owner, 2026-10-08). A session's
 * weight is the rider's word on how hard the day was, and it is what makes the
 * banner clear: a day weighted 0 adds nothing, so it pushed nothing.
 *
 * Pure: no Supabase, no Next, so the phone app can raise the same notice after
 * a sync.
 */

/** The rows the reminders need: the book screen's data, less the fields, parts and history. */
export interface ServiceDueData {
  book: UsageBook & { distance_unit: DistanceUnit };
  items: readonly DueItem[];
  entries: readonly (DueEntry & { items: readonly DueEntryItem[] })[];
  readings: readonly UsageReading[];
  sessions: readonly UsageSession[];
  laps: readonly UsageLap[];
  weights: readonly UsageWeight[];
  overrides: readonly DueOverride[];
}

export interface RiderClock {
  /** The rider's calendar date (`todayLocalDate`), never the server's. */
  today: string;
  /** The book owner's IANA zone. */
  timeZone: string;
}

export function dueInputOf(data: ServiceDueData, clock: RiderClock): DueInput {
  return {
    usage: {
      book: data.book,
      readings: data.readings,
      sessions: data.sessions,
      laps: data.laps,
      weights: data.weights,
    },
    distanceUnit: data.book.distance_unit,
    items: data.items,
    entries: data.entries,
    entryItems: data.entries.flatMap((entry) => entry.items),
    overrides: data.overrides,
    today: clock.today,
    timeZone: clock.timeZone,
  };
}

export function computeBookDue(data: ServiceDueData, clock: RiderClock): ItemDue[] {
  return computeDue(dueInputOf(data, clock));
}

/** What needs the rider's attention: overdue first, due soon after, in schedule order. */
export interface DueSummary {
  overdue: ItemDue[];
  dueSoon: ItemDue[];
  /** The worst of them, for a chip's tone; `null` when nothing needs attention. */
  status: 'overdue' | 'due_soon' | null;
}

export function summarizeDue(due: readonly ItemDue[]): DueSummary {
  const overdue = due.filter((item) => item.status === 'overdue');
  const dueSoon = due.filter((item) => item.status === 'due_soon');
  return {
    overdue,
    dueSoon,
    status: overdue.length > 0 ? 'overdue' : dueSoon.length > 0 ? 'due_soon' : null,
  };
}

function countOrName(items: readonly ItemDue[], suffix: string): string | null {
  if (items.length === 0) return null;
  if (items.length === 1) return `${items[0].name} ${suffix}`;
  return `${items.length} ${suffix}`;
}

/**
 * A chip's text: `Engine oil and filter overdue`, `2 due soon`,
 * `Brake pads overdue · 2 due soon`; `null` when nothing needs attention. One
 * item is named, several are counted, so a chip never runs to a paragraph.
 */
export function describeDueSummary(summary: DueSummary): string | null {
  const parts = [countOrName(summary.overdue, 'overdue'), countOrName(summary.dueSoon, 'due soon')].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** How far a status is from fine; a status the push rule does not read ranks 0. */
const PUSH_RANK: Record<ItemDueStatus, number> = {
  no_interval: 0,
  unknown: 0,
  snoozed: 0,
  ok: 1,
  due_soon: 2,
  overdue: 3,
};

export interface SessionDuePush {
  itemId: string;
  name: string;
  /** Where the item stood without this session. */
  from: ItemDueStatus;
  /** Where this session's usage put it. */
  to: 'due_soon' | 'overdue';
}

/** The same rows with these sessions weighted 0: still there, so no anchor moves, but adding nothing. */
function withSessionsUncounted(data: ServiceDueData, sessionIds: readonly string[]): ServiceDueData {
  const uncounted = new Set(sessionIds);
  return {
    ...data,
    weights: [
      ...data.weights.filter((weight) => !uncounted.has(weight.session_id)),
      ...sessionIds.map((sessionId) => ({ session_id: sessionId, weight: 0, minutes_override: null, distance_override: null })),
    ],
  };
}

/**
 * The items this one session carried across `due_soon` or `overdue`, in date
 * order: due with the sessions up to and including this one, as the rider
 * weighted them, against due with the sessions strictly before it, so only the
 * day that crossed the line says so. Neither side drops a row - a session left
 * out is weighted 0 - so the never-done and days anchors are the same on both. A
 * session the rider weighted 0 gives both sides the same rows, so it pushed
 * nothing, which is what lets the rider say "this day did not count" and watch
 * the notice clear. A snoozed item is not pushed - the rider has already
 * answered it - and an item with no interval or no usage to measure cannot be.
 */
export function describeSessionDuePush(data: ServiceDueData, sessionId: string, clock: RiderClock): SessionDuePush[] {
  const session = data.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) return [];
  const later = data.sessions.filter((other) => compareSessionsAsc(other, session) > 0).map((other) => other.id);
  const withSession = computeBookDue(withSessionsUncounted(data, later), clock);
  const withoutSession = computeBookDue(withSessionsUncounted(data, [...later, sessionId]), clock);
  const before = new Map(withoutSession.map((item) => [item.itemId, item]));

  const pushed: SessionDuePush[] = [];
  for (const item of withSession) {
    if (item.status !== 'due_soon' && item.status !== 'overdue') continue;
    const was = before.get(item.itemId);
    if (!was) continue;
    if (PUSH_RANK[item.status] > PUSH_RANK[was.status]) {
      pushed.push({ itemId: item.itemId, name: item.name, from: was.status, to: item.status });
    }
  }
  return pushed;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The banner's sentence: `This day pushed Engine oil and filter past due.`,
 * `This day brought Tires due soon.`, or both joined; `null` when nothing was
 * pushed.
 */
export function describeSessionDuePushText(pushed: readonly SessionDuePush[]): string | null {
  const overdue = pushed.filter((push) => push.to === 'overdue').map((push) => push.name);
  const soon = pushed.filter((push) => push.to === 'due_soon').map((push) => push.name);
  const clauses: string[] = [];
  if (overdue.length > 0) clauses.push(`pushed ${joinNames(overdue)} past due`);
  if (soon.length > 0) clauses.push(`brought ${joinNames(soon)} due soon`);
  if (clauses.length === 0) return null;
  return `This day ${clauses.join(' and ')}.`;
}

/**
 * How hard a day was, as the rider says it. The weight column takes 0 to 3;
 * these three are what the screens offer (owner's words: a small-track day may
 * not count, a big day at COTA counts double). A stored weight outside them
 * still applies to the usage math; the control just shows nothing pressed.
 */
export type SessionWeightChoice = 'none' | 'normal' | 'heavy';

export const SESSION_WEIGHT_CHOICES: readonly { value: SessionWeightChoice; weight: number; label: string }[] = [
  { value: 'none', weight: 0, label: 'Doesn’t count' },
  { value: 'normal', weight: 1, label: 'Normal' },
  { value: 'heavy', weight: 2, label: 'Heavy' },
];

/** The choice a stored weight shows as; `null` for no row, or a weight the control does not offer. */
export function weightChoiceOf(weight: number | null | undefined): SessionWeightChoice | null {
  if (typeof weight !== 'number' || !Number.isFinite(weight)) return null;
  return SESSION_WEIGHT_CHOICES.find((choice) => choice.weight === weight)?.value ?? null;
}

export function weightOfChoice(choice: SessionWeightChoice): number {
  const found = SESSION_WEIGHT_CHOICES.find((candidate) => candidate.value === choice);
  if (!found) throw new Error(`unknown session weight choice ${choice}`);
  return found.weight;
}

/**
 * The override in force, in the rider's words: `Snoozed until 20 Oct 2026`,
 * `Snoozed until 50 h or 1,300 mi`, `Snoozed until logged again`, `Skipped a
 * cycle on 20 Sep 2026`, `Next due set by you`. Only an override `computeDue`
 * reports in force reaches here, so a snooze that has run out is never asked.
 */
export function describeOverride(
  override: Pick<DueOverride, 'kind' | 'until_date' | 'until_hours' | 'until_distance'>,
  unit: DistanceUnit,
  state: {
    /** The day the override was made, in the owner's zone (`riderDateOfTimestamp`). */
    madeOn: string;
  },
): string {
  if (override.kind === 'skip_cycle') return `Skipped a cycle on ${formatDay(state.madeOn)}`;
  if (override.kind === 'set_next_due') return 'Next due set by you';
  const limits = [
    isIsoDate(override.until_date) ? formatDay(override.until_date) : null,
    formatHours(override.until_hours),
    formatDistance(override.until_distance, unit),
  ].filter((limit): limit is string => limit !== null);
  return limits.length > 0 ? `Snoozed until ${limits.join(' or ')}` : 'Snoozed until logged again';
}
