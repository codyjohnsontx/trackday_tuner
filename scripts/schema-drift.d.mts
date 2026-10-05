export interface InventoryComparison {
  missingFromHosted: string[];
  onlyOnHosted: string[];
  platform: { missingFromHosted: string[]; onlyOnHosted: string[] };
  notes: string[];
}

export function parseInventoryCsv(text: string): string[];
export function describeUnusableInventory(label: string, lines: string[]): string | null;
export function compareInventories(reference: string[], hosted: string[]): InventoryComparison;
export function hasDrift(result: InventoryComparison): boolean;
export function formatDriftReport(result: InventoryComparison): string;
export function readLocalInventory(): string[];
export function main(argv: string[], readReference?: () => string[]): number;
