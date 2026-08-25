import { createClient } from '@supabase/supabase-js';
import type { RemotePattern } from 'next/dist/shared/lib/image-config';
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOSTED_SUPABASE_STORAGE,
  SUPABASE_PUBLIC_OBJECT_PATHNAME,
  escapeForRemotePattern,
  supabaseStorageRemotePatterns,
} from '@/lib/supabase-storage-remote-patterns';

// Guards the invariant that `next/image` can fetch a vehicle photo from whichever
// Supabase project the app is configured against - a hosted one, a local
// `supabase start`, a self-hosted URL with or without a path prefix - and from
// nowhere else.
//
// components/garage/vehicle-card.tsx renders the URL the form stored through
// `next/image`, and `images.remotePatterns` in next.config.ts decides which
// hosts that may be. It once named only `*.supabase.co`, so against a local
// stack the upload succeeded, the row was right, the public URL answered, and
// the garage still had no photo: `next dev` threw `hostname "127.0.0.1" is not
// configured under images` at render, and a production build renders the
// `<img>` and has `/_next/image` answer 400. The rule now derives the entry from
// `NEXT_PUBLIC_SUPABASE_URL` (lib/supabase-storage-remote-patterns.ts).
//
// Matching is asserted through Next's own `hasRemoteMatch`, the function the
// image loader and the optimizer call, rather than by reading the objects back:
// a pattern can look right and still not admit the URL (a `port` that does not
// match, a pathname glob that does not reach the object) and only the matcher
// knows. And the URL it is asked to admit is the one the real supabase-js client
// produces for that configured value, because the entry has to admit what
// `getPublicUrl` stores and not what a reading of the origin suggests - a
// path-prefixed self-hosted URL was the case where those two disagreed. The last
// block imports next.config.ts itself, so a refactor that stops calling the
// derivation is caught at the call site and not just in the helper.
//
// WHAT IT DOES NOT CATCH: that the optimizer can reach the host and fetch the
// bytes, or that the card renders. tests/e2e/vehicle-photo-upload.spec.ts is that
// walk against a rebuilt local stack.

const BUCKET = 'vehicle-photos';
// The shape components/garage/vehicle-form.tsx stores: `<user id>/<timestamp>_<file name>`.
const OBJECT = 'df990bf0-64a6-48e3-925c-903d52444e33/1787690988916_bike.png';
// That object under the bucket's public endpoint at the root of a host.
const OBJECT_PATH = `/storage/v1/object/public/${BUCKET}/${OBJECT}`;

function admits(patterns: RemotePattern[], url: string): boolean {
  return hasRemoteMatch([], patterns, new URL(url));
}

/** What the vehicle form would store, from the real client, for this configured URL. */
function storedPhotoUrl(configuredUrl: string): string {
  return createClient(configuredUrl, 'anon-key-placeholder', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
    .storage.from(BUCKET)
    .getPublicUrl(OBJECT).data.publicUrl;
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

  it('admits exactly the URL supabase-js stores, for every shape of configured URL', () => {
    // The client resolves `storage/v1` against the configured value after
    // guaranteeing a trailing slash, so a path prefix survives, a query does
    // not, and the host is lowercased while the path is not. The entry follows
    // the same construction, so it agrees with the client on each of those
    // rather than on a reading of what the value "means".
    for (const configured of [
      'http://127.0.0.1:55321',
      'http://127.0.0.1:55321/',
      'https://abcdefghijklmnop.supabase.co',
      'https://supabase.example.com',
      'https://example.com/supabase',
      'https://example.com/supabase/',
      'https://Example.COM/Supabase//',
      'https://example.com/supabase?x=1',
    ]) {
      const stored = storedPhotoUrl(configured);
      expect(admits(supabaseStorageRemotePatterns(configured), stored), `${configured} -> ${stored}`).toBe(
        true,
      );
    }
  });

  it('keeps a path prefix on a self-hosted URL and admits nothing above it', () => {
    const patterns = supabaseStorageRemotePatterns('https://example.com/supabase');
    expect(patterns[1]).toEqual({
      protocol: 'https',
      hostname: 'example.com',
      port: '',
      pathname: '/supabase/storage/v1/object/public/**',
    });
    expect(admits(patterns, `https://example.com/supabase${OBJECT_PATH}`)).toBe(true);
    // The root endpoint on that host is a different service's, or nobody's.
    expect(admits(patterns, `https://example.com${OBJECT_PATH}`)).toBe(false);
    expect(admits(patterns, 'https://example.com/supabase/rest/v1/profiles')).toBe(false);
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
      'https://example.com/supabase',
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

  it('does not widen to other hosts', () => {
    const patterns = supabaseStorageRemotePatterns('http://127.0.0.1:55321');
    expect(admits(patterns, `https://photos.example${OBJECT_PATH}`)).toBe(false);
    expect(admits(patterns, `https://abc.supabase.co.example${OBJECT_PATH}`)).toBe(false);
    expect(admits(patterns, `http://abc.supabase.co${OBJECT_PATH}`)).toBe(false);
  });

  it('escapes a hostname picomatch would otherwise read as a character class', () => {
    // `url.hostname` keeps the brackets of an IPv6 literal, and to picomatch
    // `[2001:db8::1]` is a class matching any one of those characters - so the
    // "exact host" entry admitted `d` or `b` on the same port. Escaped, it
    // admits the literal and nothing else.
    const patterns = supabaseStorageRemotePatterns('http://[2001:db8::1]:54321');
    expect(patterns[1]).toEqual({
      protocol: 'http',
      hostname: '\\[2001:db8::1\\]',
      port: '54321',
      pathname: SUPABASE_PUBLIC_OBJECT_PATHNAME,
    });
    expect(admits(patterns, `http://[2001:db8::1]:54321${OBJECT_PATH}`)).toBe(true);
    for (const host of ['d', 'b', 'db8']) {
      expect(admits(patterns, `http://${host}:54321${OBJECT_PATH}`), host).toBe(false);
    }
    // The control: the unescaped hostname is what admitted a one-character host.
    const unescaped: RemotePattern = { ...patterns[1], hostname: '[2001:db8::1]' };
    expect(admits([unescaped], `http://d:54321${OBJECT_PATH}`)).toBe(true);
  });

  it('escapes the path prefix the same way', () => {
    const patterns = supabaseStorageRemotePatterns('https://example.com/supa[base]');
    expect(patterns[1].pathname).toBe('/supa\\[base\\]/storage/v1/object/public/**');
    expect(admits(patterns, `https://example.com/supa[base]${OBJECT_PATH}`)).toBe(true);
    expect(admits(patterns, `https://example.com/supab${OBJECT_PATH}`)).toBe(false);
  });

  it('leaves a hostname made of literals untouched', () => {
    // `.` and `-` are not glob syntax, so the common cases read as before and
    // the escaping only shows where it is needed.
    for (const literal of ['127.0.0.1', 'abc.supabase.co', 'supabase.example-host.com']) {
      expect(escapeForRemotePattern(literal)).toBe(literal);
    }
    expect(escapeForRemotePattern('supa*base.example')).toBe('supa\\*base.example');
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
