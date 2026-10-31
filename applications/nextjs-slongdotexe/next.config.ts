import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const cacheHandlerPath = fileURLToPath(
  new URL("./src/cache/use-cache-handler.mts", import.meta.url),
);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  cacheComponents: true,
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
