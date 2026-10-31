/* eslint-disable @typescript-eslint/no-require-imports */
const { AsyncLocalStorage } = require("node:async_hooks");
const { Logger } = require("@aws-lambda-powertools/logger");
const { Tracer } = require("@aws-lambda-powertools/tracer");

const serviceName = process.env.POWERTOOLS_SERVICE_NAME || "nextjs-slongdotexe";
const context = new AsyncLocalStorage();
const baseLogger = new Logger({ serviceName });
const tracer = new Tracer({
  serviceName,
  enabled:
    process.env.POWERTOOLS_TRACE_ENABLED !== "false" &&
    Boolean(
      process.env.AWS_LAMBDA_HTTP_ENDPOINT ||
      process.env.AWS_LAMBDA_FUNCTION_NAME,
    ),
  captureHTTPsRequests: true,
});
tracer.provider.setContextMissingStrategy(() => {});

const logger = new Proxy(baseLogger, {
  get(target, property) {
    const activeLogger = context.getStore()?.logger || target;
    const value = Reflect.get(activeLogger, property, activeLogger);
    return typeof value === "function" ? value.bind(activeLogger) : value;
  },
});

module.exports = { logger, tracer, context, serviceName };
