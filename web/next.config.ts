import type { NextConfig } from "next";

const config: NextConfig = {
  // The end to end tests build the site more than once, each into a folder of its own.
  distDir: process.env.SHELFMARK_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  // The development server would otherwise write a notes file for coding tools into the project.
  agentRules: false,
  // Lets the development server be opened by address as well as by name.
  allowedDevOrigins: ["127.0.0.1"],
};

export default config;
