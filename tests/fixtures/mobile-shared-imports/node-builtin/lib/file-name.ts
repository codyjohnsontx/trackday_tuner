import path from 'path';

export function fileName(value: string): string {
  return path.basename(value);
}
