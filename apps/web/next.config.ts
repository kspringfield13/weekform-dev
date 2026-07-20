import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/downloads/9f93bedd11eb1813/Weekform_0.1.0_universal.dmg",
        headers: [
          {
            key: "Content-Disposition",
            value: 'attachment; filename="Weekform_0.1.0_universal.dmg"',
          },
          { key: "Content-Type", value: "application/x-apple-diskimage" },
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  turbopack: {
    // This app is self-contained; do not infer a workspace root from
    // lockfiles higher up the filesystem.
    root: path.join(__dirname),
  },
};

export default nextConfig;
