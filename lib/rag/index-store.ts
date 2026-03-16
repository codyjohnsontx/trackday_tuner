import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RagIndex } from '@/lib/rag/types';

export function getDefaultIndexPath(): string {
  return path.join(process.cwd(), 'data', 'rag', 'index.json');
}

export async function loadRagIndex(indexPath = getDefaultIndexPath()): Promise<RagIndex | null> {
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(raw) as RagIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function saveRagIndex(index: RagIndex, indexPath = getDefaultIndexPath()): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}
