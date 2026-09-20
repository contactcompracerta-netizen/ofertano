import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "@vercel/turbopack-next/internal/font/google/cssmodule.module.css": "./node_modules/@vercel/turbopack-next/internal/font/google/cssmodule.module.css",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "http2.mlstatic.com",
      },
      {
        protocol: "https",
        hostname: "http.mlstatic.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/admin/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
