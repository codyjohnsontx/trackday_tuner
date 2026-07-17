'use client';

import type { Json, ProductEventName } from '@/types/supabase';

export function trackProductEvent(
  eventName: ProductEventName,
  details: { session_id?: string; vehicle_id?: string; properties?: Json } = {},
) {
  if (eventName === 'beta_signup_completed') return;
  void fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ event_id: crypto.randomUUID(), event_name: eventName, ...details }),
  }).catch(() => undefined);
}
