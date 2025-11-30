import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a standalone build so we can deploy minimal artifacts
  output: "standalone",
};

export default nextConfig;
