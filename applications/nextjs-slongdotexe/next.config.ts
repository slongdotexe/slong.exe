import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const cacheHandlerPath = fileURLToPath(
  new URL("./src/cache/use-cache-handler.cjs", import.meta.url),
);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      "./src/cache/handler.cjs",
      "./src/cache/use-cache-handler.cjs",
      "./src/cache/runtime.cjs",
      "./src/cache/worker.cjs",
      "./web-function-entrypoint.cjs",
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
