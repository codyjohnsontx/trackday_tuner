// Once read the plural off the request locale:
// import { headers } from 'next/headers';
export function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
