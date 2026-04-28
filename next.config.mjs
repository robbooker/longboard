/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prevent dev/build processes from corrupting each other by writing into the same
  // directory. Default is ".next" if NEXT_DIST_DIR is not set.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
