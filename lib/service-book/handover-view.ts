import { getFreePlanLimitMessage } from '@/lib/plans';

/**
 * What the handover link page shows a buyer (owner, PQ2; TQ1 to TQ7), worked out
 * from what `describe_service_book_transfer` (20261017000600) answered for the
 * viewer and from the buyer's own garage - never from a row. The page prints
 * this; `tests/e2e/service-book-handover.spec.ts` is the walk.
 *
 * Pure: no Supabase, no Next, so the phone app can render the same page.
 */

/** What the server read off the bike for the recipient of a pending link. */
export interface HandoverBike {
  nickname: string;
  type: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  photo_url: string | null;
}

/** The counts the seller was shown when they made the link, stored on the handover row. */
export interface HandoverSummary {
  entries: number;
  removed_entries: number;
  items: number;
  readings: number;
  attachments: number;
  attachment_bytes: number;
  sessions: number;
  laps: number;
  session_photos: number;
  outcomes: number;
  weights: number;
  overrides: number;
}

/** What `describe_service_book_transfer` answers, as the page reads it. */
export type HandoverDescription =
  | { status: 'not_found' }
  | { status: 'pending' | 'expired' | 'accepted' | 'cancelled'; viewer: 'signed_out' | 'seller' | 'recipient' | 'other' }
  | { status: 'pending'; viewer: 'recipient'; bike: HandoverBike | null; summary: HandoverSummary; expires_at: string }
  | { status: 'accepted'; viewer: 'recipient'; vehicle_id: string };

export type HandoverPage =
  /** Nobody is signed in: offer to sign in and come back. Nothing about the bike is shown. */
  | { kind: 'sign_in' }
  /** Not pending any more, or never was - one answer, so a link reveals nothing. */
  | { kind: 'invalid' }
  /** Signed in, but not with the address the seller typed. The address is not shown. */
  | { kind: 'wrong_account' }
  /** The seller opened their own link. */
  | { kind: 'own_link' }
  /** This rider accepted it already: the bike is in their garage. */
  | { kind: 'accepted'; vehicleId: string }
  /** The recipient of a pending link: the bike, what comes with it, and Accept (or the plan notice). */
  | { kind: 'offer'; bike: HandoverBike | null; summary: HandoverSummary; expiresAt: string; atVehicleLimit: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** The summary as a function returned it: every count a number, missing ones zero. */
export function readHandoverSummary(value: unknown): HandoverSummary {
  const row = isRecord(value) ? value : {};
  return {
    entries: count(row.entries),
    removed_entries: count(row.removed_entries),
    items: count(row.items),
    readings: count(row.readings),
    attachments: count(row.attachments),
    attachment_bytes: count(row.attachment_bytes),
    sessions: count(row.sessions),
    laps: count(row.laps),
    session_photos: count(row.session_photos),
    outcomes: count(row.outcomes),
    weights: count(row.weights),
    overrides: count(row.overrides),
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The bike as the function returned it, or null when it returned none. */
export function readHandoverBike(value: unknown): HandoverBike | null {
  if (!isRecord(value)) return null;
  const nickname = text(value.nickname);
  if (!nickname) return null;
  return {
    nickname,
    type: text(value.type),
    year: typeof value.year === 'number' ? value.year : null,
    make: text(value.make),
    model: text(value.model),
    photo_url: text(value.photo_url),
  };
}

/** The function's answer, read without trusting its shape. */
export function readHandoverDescription(value: unknown): HandoverDescription {
  if (!isRecord(value)) return { status: 'not_found' };
  const status = value.status;
  const viewer = value.viewer;
  if (status !== 'pending' && status !== 'expired' && status !== 'accepted' && status !== 'cancelled') return { status: 'not_found' };
  if (viewer !== 'signed_out' && viewer !== 'seller' && viewer !== 'recipient' && viewer !== 'other') return { status: 'not_found' };
  if (status === 'pending' && viewer === 'recipient' && typeof value.expires_at === 'string') {
    return { status, viewer, bike: readHandoverBike(value.bike), summary: readHandoverSummary(value.summary), expires_at: value.expires_at };
  }
  if (status === 'accepted' && viewer === 'recipient' && typeof value.vehicle_id === 'string') {
    return { status, viewer, vehicle_id: value.vehicle_id };
  }
  return { status, viewer };
}

/**
 * Which page a viewer gets. `atVehicleLimit` is the buyer's own garage against
 * the free plan (`vehiclesTowardPlan`, `isAtFreePlanLimit`), which only matters
 * for the recipient of a pending link: the database refuses the accept the
 * same way (TT402), and the page offers no button that would only refuse.
 */
export function resolveHandoverPage(description: HandoverDescription, atVehicleLimit: boolean): HandoverPage {
  if (description.status === 'not_found') return { kind: 'invalid' };
  if (description.viewer === 'signed_out') return { kind: 'sign_in' };
  if (description.status === 'accepted') {
    return 'vehicle_id' in description ? { kind: 'accepted', vehicleId: description.vehicle_id } : { kind: 'invalid' };
  }
  if (description.status !== 'pending') return { kind: 'invalid' };
  if (description.viewer === 'seller') return { kind: 'own_link' };
  if (description.viewer === 'other') return { kind: 'wrong_account' };
  if (!('summary' in description)) return { kind: 'invalid' };
  return { kind: 'offer', bike: description.bike, summary: description.summary, expiresAt: description.expires_at, atVehicleLimit };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? 'under 0.1 MB' : `about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * What comes with the bike, in the words the seller read when they made the
 * link: one line per kind, nothing for a kind the bike has none of.
 */
export function describeHandoverSummary(summary: HandoverSummary): string[] {
  const lines: string[] = [];
  const book = [`${plural(summary.entries, 'service entry', 'service entries')}`];
  if (summary.items > 0) book.push(`${plural(summary.items, 'item')} with intervals`);
  if (summary.readings > 0) book.push(plural(summary.readings, 'reading'));
  if (summary.attachments > 0) book.push(`${plural(summary.attachments, 'receipt or photo', 'receipts and photos')} (${megabytes(summary.attachment_bytes)})`);
  lines.push(`The service book: ${book.join(', ')}.`);
  if (summary.removed_entries > 0) {
    lines.push(`${plural(summary.removed_entries, 'entry', 'entries')} removed by an owner: counted, not shown.`);
  }
  const sessions = [plural(summary.sessions, 'track session')];
  if (summary.laps > 0) sessions.push(plural(summary.laps, 'lap time'));
  if (summary.session_photos > 0) sessions.push(plural(summary.session_photos, 'photo'));
  if (summary.outcomes > 0) sessions.push(plural(summary.outcomes, 'outcome note'));
  lines.push(`Track sessions on this bike: ${sessions.join(', ')}.`);
  if (summary.weights > 0 || summary.overrides > 0) {
    const word: string[] = [];
    if (summary.weights > 0) word.push(`${plural(summary.weights, 'session')} the owner weighted`);
    if (summary.overrides > 0) word.push(plural(summary.overrides, 'snooze or adjustment', 'snoozes and adjustments'));
    lines.push(`The owner's word on the schedule: ${word.join(' and ')}.`);
  }
  return lines;
}

/** What is not copied, because it is about the rider rather than the bike (TQ5). */
export const STAYS_WITH_SELLER = [
  'their Race Engineer advice and what it learned about this bike',
  'their saved baseline setup',
  'their AI questions',
] as const;

/** 32 random bytes as base64url is 43 characters; a wider band in case the link's maker changes that. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;

export function isHandoverTokenShape(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_SHAPE.test(token);
}

/** Where a signed-out buyer is sent back to once signed in. */
export function handoverPath(token: string): `/transfer/${string}` {
  return `/transfer/${token}`;
}

export const HANDOVER_COPY = {
  invalid: 'This handover link is not valid any more.',
  wrongAccount: 'This handover was sent to a different email address. Sign in with the address the seller used.',
  ownLink: 'This is the link you made for your buyer. Send it to them; it is not for your own account.',
  failed: 'The handover could not be completed. Try again.',
  copyFailed: 'The receipts and photos could not be copied yet. Try again in a moment.',
  alreadySold: 'This bike was handed over already.',
  notSignedIn: 'Sign in to accept this handover.',
} as const;

/**
 * What a refused accept tells the buyer, by the code the database answered
 * with (20261017000600): TT404 not pending, TT403 the wrong account, TT402 the
 * free vehicle cap, TT410 a bike sold meanwhile, TT409 a copy that did not
 * settle after retrying, 42501 nobody signed in.
 */
export function describeAcceptRefusal(code: string | undefined): string {
  switch (code) {
    case 'TT404':
      return HANDOVER_COPY.invalid;
    case 'TT403':
      return HANDOVER_COPY.wrongAccount;
    case 'TT402':
      return getFreePlanLimitMessage('vehicles');
    case 'TT410':
      return HANDOVER_COPY.alreadySold;
    case '42501':
      return HANDOVER_COPY.notSignedIn;
    default:
      return HANDOVER_COPY.failed;
  }
}
