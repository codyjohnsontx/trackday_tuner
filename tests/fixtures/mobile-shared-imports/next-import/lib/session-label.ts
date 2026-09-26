import { requestDate } from './request-date';

export function sessionLabel(sessionNumber: number): string {
  return `Session ${sessionNumber}`;
}

export async function sessionLabelWithDate(sessionNumber: number): Promise<string> {
  return `${sessionLabel(sessionNumber)} - ${await requestDate()}`;
}
