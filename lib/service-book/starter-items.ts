import type { VehicleType } from '@/types/supabase';

/**
 * The maintenance items a new service book starts with, per vehicle type. A
 * book copies these into `service_items` with `source = 'starter'`; the rider
 * renames, archives or adds to them from there.
 *
 * They carry NO intervals, on purpose. An interval is the manufacturer's or
 * the rider's to state - typed in, or read off a photographed manual page - and
 * a default here would put a number in the book nobody gave it, which a buyer
 * would then read as the bike's schedule.
 */
export const STARTER_ITEMS: Readonly<Record<VehicleType, readonly string[]>> = {
  motorcycle: [
    'Engine oil and filter',
    'Air filter',
    'Chain and sprockets',
    'Brake fluid',
    'Brake pads',
    'Coolant',
    'Spark plugs',
    'Valve clearance',
    'Fork oil',
    'Shock service',
    'Steering head bearings',
    'Wheel bearings',
    'Tires',
  ],
  car: [
    'Engine oil',
    'Brake fluid',
    'Brake pads',
    'Coolant',
    'Gearbox oil',
    'Differential oil',
    'Tires',
    'Alignment',
  ],
};

export function starterItemsFor(type: VehicleType): readonly string[] {
  return STARTER_ITEMS[type];
}
