/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_TRADING_ENGINE_BASE_URL: process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020',
  },
};

module.exports = nextConfig;


