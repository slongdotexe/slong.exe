import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const cacheHandlerPath = fileURLToPath(
  new URL("./src/cache/use-cache-handler.mts", import.meta.url),
);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      "./src/cache/*.ts",
      "./src/cache/*.mts",
      "./src/cache/worker.mjs",
      "./src/utils/observability.mts",
      "./web-function-entrypoint.mts",
    ],
  },
  experimental: {
    isrFlushToDisk: false,
    useCache: true,
  },
  cacheHandlers: {
    default: cacheHandlerPath,
  },
};

export default nextConfig;
