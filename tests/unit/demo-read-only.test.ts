import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_READ_ONLY_ERROR } from '@/lib/demo/mode';
import { SagCalculator } from '@/components/sag/sag-calculator';

/**
 * The public demo is read-only (owner, 2026-10-04). This sweep is what keeps it
 * that way as the app grows: it finds every server action and every mutating
 * route handler on disk rather than naming them, so a write path added later is
 * refused in demo or this suite fails naming it.
 *
 * The demo cookie is set and every Supabase client throws, so a write that slips
 * past the guard fails loudly instead of reaching a database.
 */

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === 'trackday_tuner_demo' ? { value: '1' } : undefined),
    getAll: () => [{ name: 'trackday_tuner_demo', value: '1' }],
  })),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => {
    throw new Error('Supabase must not be reached in demo mode.');
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => {
    throw new Error('The admin client must not be reached in demo mode.');
  }),
}));

const ROOT = path.resolve(__dirname, '../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function sourceFiles(dir: string): string[] {
  return walk(path.join(ROOT, dir)).filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
}

const relative = (file: string) => path.relative(ROOT, file);

/** A server action is a read when its name says so. Everything else writes. */
const READ_ACTION = /^(get|has)[A-Z]/;

const serverActionModules = ['app', 'components', 'lib']
  .flatMap(sourceFiles)
  .filter((file) => /^\s*['"]use server['"];?/m.test(readFileSync(file, 'utf8')))
  .map(relative)
  .sort();

/**
 * Write routes that are deliberately not demo routes, and why. Anything not on
 * this list must answer a demo request with the read-only refusal.
 */
const NOT_DEMO_SCOPED: Record<string, string> = {
  'app/api/beta/signup/route.ts': 'creates a new real account - the way out of the demo, not a write to it',
  'app/api/beta/waitlist/route.ts': 'a public waitlist form that needs no account',
  'app/api/mobile/sessions/route.ts': 'authenticates by bearer token and never reads the demo cookie',
  'app/api/stripe/webhook/route.ts': 'called by Stripe with a signed body, never by a browser',
  'app/api/ai/recommendation-feedback/route.ts': 'a 410 tombstone that writes nothing',
};

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

const writeRoutes = sourceFiles('app/api')
  .filter((file) => path.basename(file) === 'route.ts')
  .flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return MUTATING_METHODS.filter((method) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\b`).test(source),
    ).map((method) => ({ file: relative(file), method }));
  });

// Each case imports a whole server module cold, which can outlast the default 5s.
describe('the demo is read-only', { timeout: 60_000 }, () => {
  it('finds the server actions and write routes it sweeps', () => {
    // An empty sweep passes every assertion below, so it has to fail here.
    expect(serverActionModules.length).toBeGreaterThan(0);
    expect(writeRoutes.length).toBeGreaterThan(0);
    for (const file of Object.keys(NOT_DEMO_SCOPED)) {
      expect(writeRoutes.map((route) => route.file), `${file} is exempt but no longer a write route`).toContain(file);
    }
  });

  it.each(serverActionModules)('every write action in %s refuses with the read-only message', async (file) => {
    const actions = (await import(/* @vite-ignore */ path.join(ROOT, file))) as Record<string, unknown>;
    const writes = Object.entries(actions).filter(
      ([name, value]) => typeof value === 'function' && !READ_ACTION.test(name),
    );

    for (const [name, action] of writes) {
      const fn = action as (...args: unknown[]) => Promise<unknown>;
      const args = Array.from({ length: Math.max(fn.length, 1) }, () => ({}));
      await expect(fn(...args), `${file} ${name}`).resolves.toEqual({
        ok: false,
        error: DEMO_READ_ONLY_ERROR,
      });
    }
  });

  it.each(writeRoutes.filter((route) => !(route.file in NOT_DEMO_SCOPED)))(
    '$method $file refuses with 403 and the read-only message',
    async ({ file, method }) => {
      const handlers = (await import(/* @vite-ignore */ path.join(ROOT, file))) as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      const request = new Request('http://127.0.0.1/api', {
        method,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      const response = await handlers[method](request, { params: Promise.resolve({ id: 'demo-session-1' }) });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ ok: false, error: DEMO_READ_ONLY_ERROR });
    },
  );

  it('the sag calculator offers no save in demo', () => {
    const demo = renderToStaticMarkup(createElement(SagCalculator, { initialEntries: [], demoMode: true }));
    const real = renderToStaticMarkup(createElement(SagCalculator, { initialEntries: [], demoMode: false }));

    expect(real).toContain('type="submit"');
    expect(demo).not.toContain('<form');
    expect(demo).not.toContain('type="submit"');
    expect(demo).toContain('Demo mode is read-only. Start a real account to save sag entries.');
  });
});
