import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, stripMarkdown } from '@/lib/rag/chunking';
import type { LoadedKnowledgeBaseDoc, LoadedSessionLogDoc, SessionLogFixture } from '@/lib/rag/types';

const KNOWLEDGE_BASE_DIR = path.join(process.cwd(), 'docs', 'knowledge-base');
const SESSION_LOG_DIR = path.join(process.cwd(), 'data', 'session-logs');

function stringifyValue(value: unknown, indent = 0): string[] {
  const pad = ' '.repeat(indent);

  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [`${pad}${value}`];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => stringifyValue(item, indent)).filter(Boolean);
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) => {
      const nestedLines = stringifyValue(nestedValue, indent + 2);
      if (nestedLines.length === 0) {
        return [];
      }

      if (nestedLines.length === 1) {
        return [`${pad}${key}: ${nestedLines[0].trim()}`];
      }

      return [`${pad}${key}:`, ...nestedLines];
    });
  }

  return [];
}

function formatSessionLog(session: SessionLogFixture): string {
  const parts = [
    `Date: ${session.date}`,
    `Track: ${session.track}`,
    `Bike: ${session.bike}`,
    'Setup:',
    ...stringifyValue(session.setup, 2),
    'Conditions:',
    ...stringifyValue(session.conditions, 2),
    'Rider feedback:',
    ...session.rider_feedback.map((item) => `  - ${item}`),
    `Lap times: ${session.lap_times.join(', ')}`,
  ];

  return stripMarkdown(parts.join('\n'));
}

export async function loadKnowledgeBaseDocs(): Promise<LoadedKnowledgeBaseDoc[]> {
  const entries = await fs.readdir(KNOWLEDGE_BASE_DIR);
  const docs = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.md'))
      .sort()
      .map(async (entry) => {
        const filePath = path.join(KNOWLEDGE_BASE_DIR, entry);
        const raw = await fs.readFile(filePath, 'utf8');
        const { attributes, body } = parseFrontmatter(raw);
        const id = typeof attributes.id === 'string' ? attributes.id : path.basename(entry, '.md');
        const title = typeof attributes.title === 'string' ? attributes.title : id;
        const tags = Array.isArray(attributes.tags)
          ? attributes.tags.filter((tag): tag is string => typeof tag === 'string')
          : [];

        return {
          sourceType: 'knowledge_base' as const,
          id,
          title,
          path: path.relative(process.cwd(), filePath),
          tags,
          body,
        };
      })
  );

  return docs;
}

export async function loadSessionLogDocs(): Promise<LoadedSessionLogDoc[]> {
  const entries = await fs.readdir(SESSION_LOG_DIR);
  const docs = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .sort()
      .map(async (entry) => {
        const filePath = path.join(SESSION_LOG_DIR, entry);
        const raw = await fs.readFile(filePath, 'utf8');
        const session = JSON.parse(raw) as SessionLogFixture;

        return {
          sourceType: 'session_log' as const,
          id: session.id,
          title: `${session.track} - ${session.bike} - ${session.date}`,
          path: path.relative(process.cwd(), filePath),
          text: formatSessionLog(session),
          session,
        };
      })
  );

  return docs;
}
