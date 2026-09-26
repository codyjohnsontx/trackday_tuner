import { pluralize } from './pluralize';

export function formatLapCount(count: number): string {
  return `${count} ${pluralize('lap', count)}`;
}
