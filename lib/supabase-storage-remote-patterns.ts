// Type-only, so it costs nothing in the bundle; it is where Next declares the
// shape `images.remotePatterns` takes, and a rename there fails the typecheck
// rather than the next rider's garage.
import type { RemotePattern } from 'next/dist/shared/lib/image-config';

/**
 * Where `next/image` may fetch a vehicle photo from.
 *
 * components/garage/vehicle-form.tsx stores `getPublicUrl` of the uploaded object
 * on the vehicle row, and components/garage/vehicle-card.tsx renders that URL
 * through `next/image`, which serves an image only from a host
 * `images.remotePatterns` in next.config.ts names. The URL is the configured
 * project's own storage endpoint, so the host is derived from
 * `NEXT_PUBLIC_SUPABASE_URL` rather than written down a second time: a hosted
 * project, a local `supabase start` on `http://127.0.0.1:54321` and a self-hosted
 * deployment all render under one rule, and nothing is opened beyond the project
 * the app already talks to - the port is part of the match, so a local stack's
 * URL does not admit another service on the same address.
 *
 * The entry has to admit exactly the URL supabase-js will store, so it is built
 * the way supabase-js builds that URL and not by reading the origin off the
 * value. `SupabaseClient` guarantees a trailing slash on the raw string
 * (`ensureTrailingSlash`) and then resolves `storage/v1` relative to it
 * (`new URL('storage/v1', baseUrl)`), which is what keeps a path prefix: a
 * self-hosted `https://example.com/supabase` stores its photos under
 * `/supabase/storage/v1/object/public/`, and a root pathname here would refuse
 * every one of them while admitting `/storage/...` on the same host.
 *
 * Next reads `hostname` and `pathname` as picomatch globs, so both are escaped
 * before they are used as literals. An IPv6 literal is the case that bites:
 * `url.hostname` for `http://[2001:db8::1]:54321` is `[2001:db8::1]`, and
 * unescaped that is a character class matching `d` or `b` - a one-character
 * host on the same port that a crafted `photo_url` could point `/_next/image`
 * at. Escaping keeps the entry exact for whatever host was configured; it is not
 * a promise that an IPv6 literal works end to end (supabase-js percent-encodes
 * the brackets into a public URL `new URL` cannot parse at all).
 *
 * `*.supabase.co` stays as its own entry, so a photo already stored on any hosted
 * project keeps rendering whatever this deployment's URL is set to, and a build
 * with the URL unset (`next build` in CI prerenders against placeholders) still
 * names the hosted platform.
 *
 * That wildcard was once the whole rule. Against a local stack the upload
 * succeeded, the row was right and the public URL answered, and the garage card
 * still had nothing to show: `next dev` threw `hostname "127.0.0.1" is not
 * configured under images` at render, and a production build renders the `<img>`
 * and has `/_next/image` answer 400. tests/e2e/vehicle-photo-upload.spec.ts walks
 * the rendered card against a rebuilt stack;
 * tests/unit/next-image-remote-patterns.test.ts runs Next's own matcher over what
 * this returns, against the URLs the real supabase-js client produces.
 */

/** The public object endpoint `getPublicUrl` points at, relative to the project URL. */
const PUBLIC_OBJECT_ENDPOINT = 'storage/v1/object/public/';

/** The same endpoint at the root of a host, which is where a hosted project serves it. */
export const SUPABASE_PUBLIC_OBJECT_PATHNAME = `/${PUBLIC_OBJECT_ENDPOINT}**`;

export const HOSTED_SUPABASE_STORAGE: RemotePattern = {
  protocol: 'https',
  hostname: '*.supabase.co',
  pathname: SUPABASE_PUBLIC_OBJECT_PATHNAME,
};

// Everything picomatch reads as syntax rather than as a character. `.` and `-`
// are literal to it, so a hostname or path made only of those passes through
// unchanged - the escaping is invisible until a value needs it.
const GLOB_SYNTAX = /[\\*?[\]{}()!+@|]/g;

/** A string `next/image` will match as itself, however picomatch would otherwise read it. */
export function escapeForRemotePattern(literal: string): string {
  return literal.replace(GLOB_SYNTAX, '\\$&');
}

/**
 * @param supabaseUrl the raw `NEXT_PUBLIC_SUPABASE_URL`, unset or blank when the
 *   app has no project configured. Anything set has to be an http(s) URL; a value
 *   this cannot read is refused here, at startup, rather than rendering every
 *   photo as a broken image.
 */
export function supabaseStorageRemotePatterns(supabaseUrl: string | undefined): RemotePattern[] {
  const configured = supabaseUrl?.trim();
  if (!configured) return [HOSTED_SUPABASE_STORAGE];

  let base: URL;
  try {
    // The trailing slash goes on the raw string, as supabase-js puts it, so the
    // resolution below lands where supabase-js lands - a value carrying a query
    // included, however odd that value is.
    base = new URL(configured.endsWith('/') ? configured : `${configured}/`);
  } catch {
    throw new Error(`Invalid NEXT_PUBLIC_SUPABASE_URL: ${configured}`);
  }
  const protocol = base.protocol.replace(/:$/, '');
  if (protocol !== 'http' && protocol !== 'https') {
    throw new Error(`Invalid NEXT_PUBLIC_SUPABASE_URL: ${configured} (expected http or https)`);
  }
  const publicObjects = new URL(PUBLIC_OBJECT_ENDPOINT, base);

  return [
    HOSTED_SUPABASE_STORAGE,
    {
      protocol,
      hostname: escapeForRemotePattern(base.hostname),
      // `''` when the URL names no port, and Next compares it against the
      // image URL's port verbatim - so this admits exactly the port the project
      // is served on, default ports included, and no other.
      port: base.port,
      pathname: `${escapeForRemotePattern(publicObjects.pathname)}**`,
    },
  ];
}
