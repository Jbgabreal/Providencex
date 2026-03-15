/** @type {import('next').NextConfig} */
const path = require('path');

// Load .env.local and root .env BEFORE Next.js processes the config
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Get values from process.env (set by dotenv above)
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_BASE_URL || process.env.TRADING_ENGINE_URL || 'http://localhost:3020';
const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE || 'true';

if (!PRIVY_APP_ID) {
  console.error('❌ NEXT_PUBLIC_PRIVY_APP_ID is missing! Check .env.local');
}

const nextConfig = {
  reactStrictMode: true,
  // Next.js will automatically embed these via DefinePlugin
  env: {
    NEXT_PUBLIC_PRIVY_APP_ID: PRIVY_APP_ID,
    NEXT_PUBLIC_BACKEND_BASE_URL: BACKEND_URL,
    NEXT_PUBLIC_DEV_MODE: DEV_MODE,
  },
  transpilePackages: ['lucide-react'],
  webpack: (config, { webpack, isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'lucide-react': require.resolve('lucide-react'),
    };

    // Ensure env vars are embedded in client bundle
    if (!isServer) {
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.env.NEXT_PUBLIC_PRIVY_APP_ID': JSON.stringify(PRIVY_APP_ID),
          'process.env.NEXT_PUBLIC_BACKEND_BASE_URL': JSON.stringify(BACKEND_URL),
          'process.env.NEXT_PUBLIC_DEV_MODE': JSON.stringify(DEV_MODE),
        })
      );
    }

    return config;
  },
};

module.exports = nextConfig;
