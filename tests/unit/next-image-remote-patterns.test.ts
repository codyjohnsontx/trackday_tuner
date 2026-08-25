import type { RemotePattern } from 'next/dist/shared/lib/image-config';
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOSTED_SUPABASE_STORAGE,
  SUPABASE_PUBLIC_OBJECT_PATHNAME,
  supabaseStorageRemotePatterns,
} from '@/lib/supabase-storage-remote-patterns';

// Guards the invariant that `next/image` can fetch a vehicle photo from whichever
// Supabase project the app is configured against - a hosted one, a local
// `supabase start`, a self-hosted URL - and from nowhere else.
//
// components/garage/vehicle-card.tsx renders the URL the form stored through
// `next/image`, and `images.remotePatterns` in next.config.ts decides which
// hosts that may be. It once named only `*.supabase.co`, so against a local
// stack the upload succeeded, the row was right, the public URL answered, and
// the garage still had no photo: `next dev` threw `hostname "127.0.0.1" is not
// configured under images` at render, and a production build renders the
// `<img>` and has `/_next/image` answer 400. The rule now derives the host from
// `NEXT_PUBLIC_SUPABASE_URL` (lib/supabase-storage-remote-patterns.ts).
//
// Matching is asserted through Next's own `hasRemoteMatch`, the function the
// image loader and the optimizer call, rather than by reading the objects back:
// a pattern can look right and still not admit the URL (a `port` that does not
// match, a pathname glob that does not reach the object) and only the matcher
// knows. The last block imports next.config.ts itself, so a refactor that stops
// calling the derivation is caught at the call site and not just in the helper.
//
// WHAT IT DOES NOT CATCH: that the optimizer can reach the host and fetch the
// bytes, or that the card renders. tests/e2e/vehicle-photo-upload.spec.ts is that
// walk against a rebuilt local stack.

// The shape components/garage/vehicle-form.tsx stores: `<user id>/<timestamp>_<file name>`
// under the bucket's public object endpoint.
const OBJECT_PATH =
  '/storage/v1/object/public/vehicle-photos/df990bf0-64a6-48e3-925c-903d52444e33/1787690988916_bike.png';

function admits(patterns: RemotePattern[], url: string): boolean {
  return hasRemoteMatch([], patterns, new URL(url));
}

describe('supabaseStorageRemotePatterns', () => {
  it('names the hosted platform and nothing else when no project is configured', () => {
    expect(supabaseStorageRemotePatterns(undefined)).toEqual([HOSTED_SUPABASE_STORAGE]);
    expect(supabaseStorageRemotePatterns('')).toEqual([HOSTED_SUPABASE_STORAGE]);
    expect(supabaseStorageRemotePatterns('   ')).toEqual([HOSTED_SUPABASE_STORAGE]);
  });

  it('derives a local stack from its URL, port included', () => {
    const patterns = supabaseStorageRemotePatterns('http://127.0.0.1:55321');
    expect(patterns).toEqual([
      HOSTED_SUPABASE_STORAGE,
      {
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '55321',
        pathname: SUPABASE_PUBLIC_OBJECT_PATHNAME,
      },
    ]);
    expect(admits(patterns, `http://127.0.0.1:55321${OBJECT_PATH}`)).toBe(true);
  });

  it('admits only the public object endpoint on that host', () => {
    const patterns = supabaseStorageRemotePatterns('http://127.0.0.1:55321');
    // Same origin, other services.
    expect(admits(patterns, 'http://127.0.0.1:55321/rest/v1/profiles')).toBe(false);
    expect(admits(patterns, 'http://127.0.0.1:55321/auth/v1/user')).toBe(false);
    expect(
      admits(patterns, 'http://127.0.0.1:55321/storage/v1/object/sign/vehicle-photos/x.png'),
    ).toBe(false);
    // Same address, another port: the app itself, or a second stack.
    expect(admits(patterns, `http://127.0.0.1:3000${OBJECT_PATH}`)).toBe(false);
    expect(admits(patterns, `http://127.0.0.1:54321${OBJECT_PATH}`)).toBe(false);
    // Same host and port, other scheme or spelling.
    expect(admits(patterns, `https://127.0.0.1:55321${OBJECT_PATH}`)).toBe(false);
    expect(admits(patterns, `http://localhost:55321${OBJECT_PATH}`)).toBe(false);
  });

  it('keeps a hosted project covered whatever the configured URL is', () => {
    const hostedPhoto = `https://abcdefghijklmnop.supabase.co${OBJECT_PATH}`;
    for (const configured of [
      undefined,
      'http://127.0.0.1:55321',
      'https://abcdefghijklmnop.supabase.co',
      'https://supabase.example.com',
    ]) {
      expect(admits(supabaseStorageRemotePatterns(configured), hostedPhoto), String(configured)).toBe(
        true,
      );
    }
  });

  it('derives a self-hosted deployment on a default port', () => {
    const patterns = supabaseStorageRemotePatterns('https://supabase.example.com');
    expect(patterns[1]).toEqual({
      protocol: 'https',
      hostname: 'supabase.example.com',
      port: '',
      pathname: SUPABASE_PUBLIC_OBJECT_PATHNAME,
    });
    expect(admits(patterns, `https://supabase.example.com${OBJECT_PATH}`)).toBe(true);
    // Naming no port means the default port, not any port.
    expect(admits(patterns, `https://supabase.example.com:8443${OBJECT_PATH}`)).toBe(false);
  });

  it('ignores a path or query on the configured URL', () => {
    // Only the origin is the project; whatever else is on the value has no
    // business narrowing or widening the object endpoint.
    expect(supabaseStorageRemotePatterns('http://127.0.0.1:55321/?x=1')[1]).toEqual(
      supabaseStorageRemotePatterns('http://127.0.0.1:55321')[1],
    );
  });

  it('does not widen to other hosts', () => {
    const patterns = supabaseStorageRemotePatterns('http://127.0.0.1:55321');
    expect(admits(patterns, `https://photos.example${OBJECT_PATH}`)).toBe(false);
    expect(admits(patterns, `https://abc.supabase.co.example${OBJECT_PATH}`)).toBe(false);
    expect(admits(patterns, `http://abc.supabase.co${OBJECT_PATH}`)).toBe(false);
  });

  it('refuses a value it cannot read rather than rendering every photo broken', () => {
    expect(() => supabaseStorageRemotePatterns('not a url')).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => supabaseStorageRemotePatterns('127.0.0.1:55321')).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
    expect(() => supabaseStorageRemotePatterns('ftp://127.0.0.1:55321')).toThrow(
      /expected http or https/,
    );
  });
});

describe('next.config.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadImagesConfig(supabaseUrl: string | undefined) {
    if (supabaseUrl === undefined) {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    } else {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl);
    }
    // The config reads the variable while the module evaluates, so it has to be
    // evaluated again for each value.
    vi.resetModules();
    const { default: config } = await import('@/next.config');
    return config.images;
  }

  it('builds images.remotePatterns from NEXT_PUBLIC_SUPABASE_URL', async () => {
    const images = await loadImagesConfig('http://127.0.0.1:55321');
    expect(images?.remotePatterns).toEqual(supabaseStorageRemotePatterns('http://127.0.0.1:55321'));
    expect(admits(images!.remotePatterns as RemotePattern[], `http://127.0.0.1:55321${OBJECT_PATH}`)).toBe(
      true,
    );
  });

  it('still names the hosted platform when the variable is unset', async () => {
    const images = await loadImagesConfig(undefined);
    expect(images?.remotePatterns).toEqual([HOSTED_SUPABASE_STORAGE]);
  });
});
