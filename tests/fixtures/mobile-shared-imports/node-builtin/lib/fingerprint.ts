import { Buffer } from 'buffer';
import { createHmac } from 'node:crypto';
import { fileName } from './file-name';

export function fingerprint(value: string): string {
  return createHmac('sha256', fileName(value)).update(Buffer.from(value)).digest('hex');
}
