import type { NextConfig } from 'next';

const config: NextConfig = {
  async rewrites() {
    const api = (process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default config;
