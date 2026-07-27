import type { NextConfig } from 'next';
import withBundleAnalyzer from '@next/bundle-analyzer';

const nextConfig: NextConfig = {
  typedRoutes: true,
  // The retriever reads the index via `path.join(process.cwd(), 'data', ...)`, which
  // output file tracing cannot follow statically. Without this the file ships in the
  // repo but is left out of the serverless bundle, and the AI routes 500 at runtime.
  outputFileTracingIncludes: {
    '/api/ai/**': ['./data/rag-index.json'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })(nextConfig);
