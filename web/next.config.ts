import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: { typedRoutes: true },
  // pg, ioredis and stripe are loaded dynamically and only when their env vars
  // are set; keeping them external stops the bundler pulling them in regardless.
  serverExternalPackages: ["pg", "ioredis", "stripe"],
};

export default config;
