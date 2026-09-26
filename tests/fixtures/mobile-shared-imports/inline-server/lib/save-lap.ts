export function lapLabel(lapNumber: number): string {
  return `Lap ${lapNumber}`;
}

export async function saveLap(lapNumber: number): Promise<string> {
  'use server';
  return lapLabel(lapNumber);
}
