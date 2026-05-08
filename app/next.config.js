/** @type {import('next').NextConfig} */
const nextConfig = {
  // PWA-ready: enable output standalone for Docker deployment
  output: "standalone",

  // Webpack config for Solana/Anchor wallet-adapter compatibility
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
      };
    }
    // Required for @solana/web3.js ESM
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",         value: "DENY" },
          { key: "X-Content-Type-Options",   value: "nosniff" },
          { key: "Referrer-Policy",          value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",       value: "camera=(self)" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
