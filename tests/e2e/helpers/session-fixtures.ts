import type { Suspension, Tires } from '@/types';

/**
 * A setup with every field left blank, for a session a spec plants directly.
 *
 * `sessions.tires` and `sessions.suspension` are shape-unconstrained `jsonb`, so
 * the database takes `{}` and the read surfaces then throw on the first
 * `tires.front.pressure`. These are the shapes the form actually submits, typed
 * so a change to either shape reaches every spec that seeds a row.
 */
export const EMPTY_TIRES: Tires = {
  front: { brand: '', compound: '', pressure: '' },
  rear: { brand: '', compound: '', pressure: '' },
  condition: null,
};

export const EMPTY_SUSPENSION: Suspension = {
  front: { preload: '', compression: '', rebound: '', direction: 'out' },
  rear: { preload: '', compression: '', rebound: '', direction: 'out' },
};
