import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything here reads live local data (SQLite + Claude), so routes render
  // dynamically; Cache Components' prerendered shells add nothing for a local app.
  cacheComponents: false,
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
