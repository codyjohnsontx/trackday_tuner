import { describe, expect, it } from 'vitest';
import { STARTER_ITEMS, starterItemsFor } from '@/lib/service-book/starter-items';

describe('starter service items', () => {
  it('has a catalog for every vehicle type', () => {
    expect(Object.keys(STARTER_ITEMS).sort()).toEqual(['car', 'motorcycle']);
    expect(starterItemsFor('motorcycle')).toContain('Engine oil and filter');
    expect(starterItemsFor('car')).toContain('Gearbox oil');
  });

  // service_items.name refuses a blank name, and two items a rider cannot tell
  // apart would split one item's history across both.
  it('names each item once, with text the database accepts', () => {
    for (const items of Object.values(STARTER_ITEMS)) {
      expect(items.length).toBeGreaterThan(0);
      for (const name of items) expect(name.trim()).toBe(name);
      for (const name of items) expect(name.length).toBeGreaterThan(0);
      const keys = items.map((name) => name.toLowerCase());
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
