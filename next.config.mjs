/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  serverExternalPackages: ['youtube-dl-exec'],
};

export default nextConfig;
