import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: true,
  // Next writes AGENTS.md/CLAUDE.md into the app dir on dev; this repo keeps its
  // guidance in README.md and ARCHITECTURE.md rather than generated stubs.
  agentRules: false,
  // pg, ioredis and stripe are loaded dynamically and only when their env vars
  // are set; keeping them external stops the bundler pulling them in regardless.
  serverExternalPackages: ["pg", "ioredis", "stripe"],
};

export default config;
