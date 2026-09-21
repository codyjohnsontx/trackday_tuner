import { vi } from 'vitest';

/** A `like` pattern as the expression it stands for: `%` is any run, `\` escapes. */
export function likeExpression(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '\\') {
      index += 1;
      if (index < pattern.length) source += pattern[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      continue;
    }
    if (char === '%') {
      source += '[\\s\\S]*';
      continue;
    }
    if (char === '_') {
      source += '[\\s\\S]';
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

/**
 * A tracks query that answers `ilike` and `eq` the way the database does, so the
 * filter the code under test builds is what decides the match rather than the mock.
 *
 * The lookup is narrowed server-side now, which means a filter tighter than the
 * fold - matching the raw typed string, say - silently stops finding circuits the
 * rider already has. Only a query mock that applies the filter can catch that.
 */
export function createTrackNameQuery(rows: { id: string; name: string; is_seeded?: boolean }[]) {
  let matched = rows;
  const query: Record<string, unknown> = {};

  query.select = vi.fn(() => query);
  query.or = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn((count: number) => {
    matched = matched.slice(0, count);
    return query;
  });
  query.eq = vi.fn((column: string, value: unknown) => {
    if (column === 'name') matched = matched.filter((row) => row.name === value);
    return query;
  });
  query.ilike = vi.fn((column: string, pattern: string) => {
    if (column !== 'name') return query;
    const expression = likeExpression(pattern);
    matched = matched.filter((row) => expression.test(row.name));
    return query;
  });
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: matched, error: null }).then(onFulfilled, onRejected);

  return query;
}
