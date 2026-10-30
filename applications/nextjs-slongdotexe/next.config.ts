import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

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
    default: fileURLToPath(
      new URL("./src/cache/use-cache-handler.cjs", import.meta.url),
    ),
  },
};

export default nextConfig;
