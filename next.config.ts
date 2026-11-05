import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'jsdom', '@mozilla/readability'],
  experimental: {
    optimizePackageImports: [],
  },
};

export default nextConfig;
