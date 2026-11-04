import type { NextConfig } from "next";

// Builds plain static files into `out/` so the app can be hosted on GitHub Pages with no server.
// NEXT_PUBLIC_BASE_PATH is "/<repo-name>" for a project page (set by the deploy workflow).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  trailingSlash: true,
  images: { unoptimized: true }
};
export default nextConfig;