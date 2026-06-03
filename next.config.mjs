/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['youtube-dl-exec'],
};

export default nextConfig;
