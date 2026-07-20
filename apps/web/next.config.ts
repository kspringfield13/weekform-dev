import path from "node:path";
import type { NextConfig } from "next";

import { buildContentSecurityPolicy } from "./lib/securityPolicy";

const browserSecurityHeaders = [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy({
      development: process.env.NODE_ENV !== "production",
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    }),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), display-capture=(), browsing-topics=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...browserSecurityHeaders],
      },
    ];
  },
  async redirects() {
    return ["weekform.com", "www.weekform.com", "www.weekform.dev"].map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: "https://weekform.dev/:path*",
      permanent: true,
    }));
  },
  turbopack: {
    // Web review controls consume the canonical domain taxonomy directly.
    // Keep Turbopack rooted at the repository so shared packages compile in
    // place instead of drifting into a Web-only copy.
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
