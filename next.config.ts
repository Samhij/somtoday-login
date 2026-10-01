import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
    ],
  },
};

export default nextConfig;
