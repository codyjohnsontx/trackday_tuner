import { createHmac } from 'node:crypto';
import { fileName } from './file-name';

export function fingerprint(value: string): string {
  return createHmac('sha256', fileName(value)).update(value).digest('hex');
}
