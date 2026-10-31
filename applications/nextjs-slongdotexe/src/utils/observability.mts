import { Logger, LogFormatter, LogItem } from "@aws-lambda-powertools/logger";
import type {
  LogAttributes,
  UnformattedAttributes,
} from "@aws-lambda-powertools/logger/types";
import { trace } from "@opentelemetry/api";
import type { Instrumentation } from "next";

class TraceLogFormatter extends LogFormatter {
  formatAttributes(
    attributes: UnformattedAttributes,
    additional: LogAttributes,
  ) {
    const span = trace.getActiveSpan()?.spanContext();
    return new LogItem({
      attributes: {
        level: attributes.logLevel,
        message: attributes.message,
        timestamp: this.formatTimestamp(attributes.timestamp),
        service: attributes.serviceName,
        ...additional,
        ...(span ? { trace_id: span.traceId, span_id: span.spanId } : {}),
      },
    });
  }
}

export const logger = new Logger({
  serviceName: process.env.OTEL_SERVICE_NAME || "nextjs-slongdotexe",
  logFormatter: new TraceLogFormatter(),
});

export function recordError(
  ...[error, request, details]: Parameters<Instrumentation.onRequestError>
) {
  logger.error("Next.js request failed", {
    error,
    errorType: error instanceof Error ? error.name : "UnknownError",
    method: request.method,
    route: details.routePath,
    routeType: details.routeType,
  });
}

export default { logger, recordError };
