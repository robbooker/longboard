/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    ];
  },
};

export default nextConfig;
