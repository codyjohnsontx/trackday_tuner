'use client';

import { useEffect } from 'react';
import { trackProductEvent } from '@/lib/product-events.client';
import type { Json, ProductEventName } from '@/types/supabase';

export function ProductEventView({ eventName, sessionId, vehicleId, properties }: {
  eventName: ProductEventName;
  sessionId?: string;
  vehicleId?: string;
  properties?: Json;
}) {
  useEffect(() => {
    trackProductEvent(eventName, { session_id: sessionId, vehicle_id: vehicleId, properties });
  }, [eventName, properties, sessionId, vehicleId]);
  return null;
}
