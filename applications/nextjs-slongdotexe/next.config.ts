import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const cacheHandlerPath = fileURLToPath(
  new URL("./src/cache/use-cache-handler.mts", import.meta.url),
);

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  cacheComponents: true,
  outputFileTracingExcludes: {
    "**/*": ["**/node_modules/sharp/**/*", "**/node_modules/@img/sharp-*/**/*"],
  },
  outputFileTracingIncludes: {
    "/*": [
      "./src/cache/*.ts",
      "./src/cache/*.mts",
      "./src/cache/worker.mjs",
      "./web-function-entrypoint.mts",
    ],
  },
  experimental: {
    isrFlushToDisk: false,
  },
  cacheHandlers: {
    default: cacheHandlerPath,
  },
};

export default nextConfig;
