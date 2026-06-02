import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hide the Next.js dev indicator widget (bottom-corner logo).
  devIndicators: false,
  // Pin the workspace root (a stray lockfile in the home dir confuses inference).
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
