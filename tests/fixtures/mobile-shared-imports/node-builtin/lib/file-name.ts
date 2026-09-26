import { statSync } from 'fs';
import path from 'path';

export function fileName(value: string): string {
  return statSync(value).isFile() ? path.basename(value) : value;
}
