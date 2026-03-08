/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: '.next-build',
  output: 'export',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
