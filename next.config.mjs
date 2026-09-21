import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // GIPHY requires browser-side API calls; this is its public browser key.
  env: {
    NEXT_PUBLIC_GIPHY_API_KEY: process.env.NEXT_PUBLIC_GIPHY_API_KEY || process.env.GIPHY || "",
  },
  outputFileTracingRoot: __dirname,
  async headers() { return [{source:'/chat-sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'}]}]; },
  async redirects() {
    return [{source: "/", has: [{type: "host", value: "chat\\.robbooker\\.com"}], destination: "/chat", permanent: false}];
  },
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
