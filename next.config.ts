import type { NextConfig } from "next";

// Enable standalone output: produces .next/standalone with the minimal server + required node_modules
// This drastically reduces deployment package size for Azure App Service.
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
