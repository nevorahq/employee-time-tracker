import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native module: must be loaded by Node at runtime, never bundled.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
