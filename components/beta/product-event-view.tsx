'use client';

import { useEffect, useRef } from 'react';
import { trackProductEvent, type ProductEventProperties } from '@/lib/product-events.client';
import type { ProductEventName } from '@/types/supabase';

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function ProductEventView({ eventName, sessionId, vehicleId, properties }: {
  eventName: ProductEventName;
  sessionId?: string;
  vehicleId?: string;
  properties?: ProductEventProperties;
}) {
  const eventKey = stableSerialize({ eventName, sessionId, vehicleId, properties: properties ?? {} });
  const lastEventKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastEventKey.current === eventKey) return;
    lastEventKey.current = eventKey;
    trackProductEvent(eventName, { session_id: sessionId, vehicle_id: vehicleId, properties });
  }, [eventKey, eventName, properties, sessionId, vehicleId]);
  return null;
}
