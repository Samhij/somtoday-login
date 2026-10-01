import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Desktop app — no Next image optimizer / sharp needed.
  images: { unoptimized: true },
  // Prevent packing previous build artifacts / Electron sources into standalone.
  outputFileTracingExcludes: {
    "*": [
      "./release/**",
      "./build/**",
      "./electron/**",
      "./dist-electron/**",
      "./electron-assets/**",
      "./.git/**",
      "./.github/**",
      "./.idea/**",
      "./docs/**",
      "./data/**",
      "./node_modules/sharp/**",
      "./node_modules/@img/**",
    ],
  },
};

export default nextConfig;
