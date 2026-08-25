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
 * this returns.
 */

/** The public object endpoint `getPublicUrl` points at, and nothing else on the host. */
export const SUPABASE_PUBLIC_OBJECT_PATHNAME = '/storage/v1/object/public/**';

export const HOSTED_SUPABASE_STORAGE: RemotePattern = {
  protocol: 'https',
  hostname: '*.supabase.co',
  pathname: SUPABASE_PUBLIC_OBJECT_PATHNAME,
};

/**
 * @param supabaseUrl the raw `NEXT_PUBLIC_SUPABASE_URL`, unset or blank when the
 *   app has no project configured. Anything set has to be an http(s) URL; a value
 *   this cannot read is refused here, at startup, rather than rendering every
 *   photo as a broken image.
 */
export function supabaseStorageRemotePatterns(supabaseUrl: string | undefined): RemotePattern[] {
  const configured = supabaseUrl?.trim();
  if (!configured) return [HOSTED_SUPABASE_STORAGE];

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`Invalid NEXT_PUBLIC_SUPABASE_URL: ${configured}`);
  }
  const protocol = url.protocol.replace(/:$/, '');
  if (protocol !== 'http' && protocol !== 'https') {
    throw new Error(`Invalid NEXT_PUBLIC_SUPABASE_URL: ${configured} (expected http or https)`);
  }

  return [
    HOSTED_SUPABASE_STORAGE,
    {
      protocol,
      hostname: url.hostname,
      // `''` when the URL names no port, and Next compares it against the
      // image URL's port verbatim - so this admits exactly the port the project
      // is served on, default ports included, and no other.
      port: url.port,
      pathname: SUPABASE_PUBLIC_OBJECT_PATHNAME,
    },
  ];
}
