import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@lastro/ui", "@lastro/contracts"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
