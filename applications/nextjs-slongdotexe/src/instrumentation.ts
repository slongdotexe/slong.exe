import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("@aws/aws-distro-opentelemetry-node-autoinstrumentation/register");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  require("node:http");
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("./utils/logger");
  logger.error("Next.js request failed", {
    error,
    errorType: error instanceof Error ? error.name : "UnknownError",
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
  });
};
