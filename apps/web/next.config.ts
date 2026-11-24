import type { NextConfig } from 'next';

// An admin panel behind a login: every page depends on the signed-in user and live data,
// so pages render per request and Cache Components stay off.
const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
