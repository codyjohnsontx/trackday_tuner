import { headers } from 'next/headers';

export async function requestDate(): Promise<string> {
  return (await headers()).get('date') ?? '';
}
