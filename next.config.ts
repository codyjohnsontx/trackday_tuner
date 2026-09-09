import type { NextConfig } from 'next';
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs/config';
import { supabaseStorageRemotePatterns } from './lib/supabase-storage-remote-patterns';

const nextConfig: NextConfig = {
  typedRoutes: true,
  // The retriever reads the index via `path.join(process.cwd(), 'data', ...)`, which
  // output file tracing cannot follow statically. Without this the file ships in the
  // repo but is left out of the serverless bundle, and the AI routes 500 at runtime.
  //
  // Every route that can reach `lib/rag/retriever` needs its own entry, because each
  // serverless function is a separate bundle: `/api/health` loading the index proves
  // nothing about `/api/ai/**`'s copy, and vice versa. That is what
  // `tests/unit/rag-index-bundling.test.ts` checks, so a future route reaching the
  // retriever fails the unit suite rather than production.
  outputFileTracingIncludes: {
    '/api/ai/**': ['./data/rag-index.json'],
    '/api/health': ['./data/rag-index.json'],
  },
  images: {
    // Vehicle photos come off the configured project's storage endpoint, so the
    // host is derived from the URL the app already reads rather than listed here
    // a second time - see lib/supabase-storage-remote-patterns.ts for the rule
    // and the local-stack failure it closes. Next loads `.env*` before it
    // evaluates this file, so `.env.local` counts.
    remotePatterns: supabaseStorageRemotePatterns(process.env.NEXT_PUBLIC_SUPABASE_URL),
  },
};

/**
 * Everything the build plugin does beyond rewriting the bundle needs a Sentry
 * auth token: uploading source maps, and creating a release to attach them to.
 * CI and every local checkout have none, and asking anyway prints a warning on
 * every build - which is how a log stops being read.
 */
const sentryUploadEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN);

/**
 * Sentry wraps the config in every environment, including CI and a local
 * checkout with no credentials, so the build that ships is the build that was
 * tested. Without `NEXT_PUBLIC_SENTRY_DSN` the SDK is never initialised at all
 * (lib/sentry-options.ts), so this costs an unconfigured deployment nothing but
 * the bundle.
 */
export default withSentryConfig(
  withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })(nextConfig),
  {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    // Loud only when there is something to be loud about: with a token, a
    // failed source-map upload matters and the log is the only place it shows.
    // Without one the plugin otherwise warns on every build about a release it
    // was never asked to create.
    silent: !sentryUploadEnabled,
    sourcemaps: { disable: !sentryUploadEnabled },
    release: { create: sentryUploadEnabled },
    // Sentry's build plugin phones home about the build by default. There is no
    // Sentry project to correlate it with until a DSN is set, so it is off.
    telemetry: false,
    // The client SDK lands in the bundle every rider downloads, so the parts
    // this project does not use are excluded. Session Replay is never
    // initialised (lib/sentry-options.ts explains why), and without these its
    // shadow-DOM, iframe and worker support ships anyway.
    bundleSizeOptimizations: {
      excludeDebugStatements: true,
      // Tracing is excluded rather than sampled. This is a mobile-first app and
      // the client SDK is downloaded by every rider on track-side 4G; the
      // performance question it would answer - how slow is the AI path - is
      // already answered from `ai_requests` by /api/monitoring/ai-health, on a
      // schema this project owns. Errors come from Sentry, latency from the
      // audit table.
      excludeTracing: true,
      excludeReplayShadowDom: true,
      excludeReplayIframe: true,
      excludeReplayWorker: true,
    },
  },
);
