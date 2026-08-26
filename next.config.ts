import type { NextConfig } from 'next';
import withBundleAnalyzer from '@next/bundle-analyzer';
import { supabaseStorageRemotePatterns } from './lib/supabase-storage-remote-patterns';

const nextConfig: NextConfig = {
  typedRoutes: true,
  // The retriever reads the index via `path.join(process.cwd(), 'data', ...)`, which
  // output file tracing cannot follow statically. Without this the file ships in the
  // repo but is left out of the serverless bundle, and the AI routes 500 at runtime.
  outputFileTracingIncludes: {
    '/api/ai/**': ['./data/rag-index.json'],
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

export default withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })(nextConfig);
