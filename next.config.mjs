import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  async rewrites() {
    return [
      {
        source: '/houston',
        destination: '/houston/index.html',
      },
      {
        source: '/houston/slides',
        destination: '/houston/slides/index.html',
      },
      {
        source: '/morning-process',
        destination: '/morning-process.html',
      },
    ];
  },
};

export default nextConfig;
