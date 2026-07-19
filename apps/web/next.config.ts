import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    // This app is self-contained; do not infer a workspace root from
    // lockfiles higher up the filesystem.
    root: path.join(__dirname),
  },
};

export default nextConfig;
