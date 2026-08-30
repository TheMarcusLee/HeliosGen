import path from "node:path";
import type { NextConfig } from "next";

// Desktop (Tauri) builds run `next build` with DESKTOP_BUILD=1 and ship the
// self-contained `.next/standalone` server as a bundled sidecar. Web/Vercel
// builds leave this unset and keep the default output.
const DESKTOP_BUILD = process.env.DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.64.2"],
  ...(DESKTOP_BUILD ? { output: "standalone" as const } : {}),
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    proxyClientMaxBodySize: '30mb',
  },
  serverExternalPackages: ["undici"],
  // `sharp` is a native module; the file tracer misses its platform binaries
  // unless we point at them explicitly for the standalone bundle.
  outputFileTracingIncludes: {
    "/**": ["node_modules/sharp/**/*", "node_modules/@img/**/*"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "*.replicate.delivery" },
      { protocol: "https", hostname: "pbxt.replicate.delivery" },
      { protocol: "https", hostname: "*.replicate.com" },
      { protocol: "https", hostname: "*.aiquickdraw.com" },
    ],
  },
};

export default nextConfig;
