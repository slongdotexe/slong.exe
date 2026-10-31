import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Server, type IncomingMessage, type ServerResponse } from "node:http";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import xray from "aws-xray-sdk-core";
import type {
  InitializeHandler,
  InitializeHandlerOptions,
} from "@smithy/types";
import {
  XRayClient,
  PutTraceSegmentsCommand,
  type PutTraceSegmentsCommandOutput,
} from "@aws-sdk/client-xray";
import type { Instrumentation } from "next";

type RequestSegment = xray.Segment & {
  http?: {
    request: { method?: string; url: string };
    response?: { status: number };
  };
};

type RequestContext = {
  logger: Logger;
  segment?: RequestSegment;
  requestId: string;
};

type TraceDocument = {
  metadata?: unknown;
  cause?: unknown;
  http?: { request?: { client_ip?: string; url?: string } };
  subsegments?: TraceDocument[];
};

type RegisterOptions = {
  sampleRate?: number;
  traceClient?: {
    send(
      command: PutTraceSegmentsCommand,
    ): Promise<Pick<PutTraceSegmentsCommandOutput, "UnprocessedTraceSegments">>;
  };
};

type TraceContextMiddleware = <Input extends object, Output extends object>(
  next: InitializeHandler<Input, Output>,
) => InitializeHandler<Input, Output>;

type TraceableClient = {
  middlewareStack: {
    add(
      middleware: TraceContextMiddleware,
      options: InitializeHandlerOptions & { override: boolean },
    ): void;
  };
};

function createObservability() {
  const serviceName =
    process.env.POWERTOOLS_SERVICE_NAME || "nextjs-slongdotexe";
  const context = new AsyncLocalStorage<RequestContext>();
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

  let registered = false;
  const pendingExports = new Set<Promise<void>>();
  let exportSegment: ((segment: xray.Segment) => void) | undefined;

  class HttpRequestSegment extends xray.Segment {
    override flush() {
      if (!exportSegment) return super.flush();
      if (!this.notTraced) exportSegment(this);
    }
  }

  function sanitize(document: TraceDocument): TraceDocument {
    delete document.metadata;
    delete document.cause;
    if (document.http?.request) {
      delete document.http.request.client_ip;
      const rawUrl = document.http.request.url;
      if (rawUrl) {
        try {
          const url = new URL(rawUrl);
          document.http.request.url = `${url.protocol}//${url.host}/`;
        } catch {
          delete document.http.request.url;
        }
      }
    }
    for (const child of document.subsegments || []) sanitize(child);
    return document;
  }

  function register(options: RegisterOptions = {}) {
    if (registered) return;
    registered = true;
    const enabled = tracer.isTracingEnabled();
    const defaultSampleRate =
      process.env.ENVIRONMENT === "development" ? "1" : "0.05";
    const configuredRate = Number(
      process.env.XRAY_SAMPLE_RATE || defaultSampleRate,
    );
    const sampleRate = options.sampleRate ?? configuredRate;
    if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
      registered = false;
      throw new Error("XRAY_SAMPLE_RATE must be between zero and one");
    }
    const namespace = xray.getNamespace();
    if (enabled && process.env.AWS_LAMBDA_HTTP_ENDPOINT) {
      xray.setStreamingThreshold(Number.MAX_SAFE_INTEGER);
      const client =
        options.traceClient ||
        new XRayClient({
          maxAttempts: 2,
          requestHandler: { connectionTimeout: 500, requestTimeout: 2000 },
        });
      exportSegment = (segment) => {
        try {
          const document = JSON.stringify(
            sanitize(JSON.parse(segment.format()) as TraceDocument),
          );
          if (
            Buffer.byteLength(document) > 64 * 1024 ||
            pendingExports.size >= 8
          ) {
            baseLogger.warn("Trace dropped: export capacity exceeded");
            return;
          }
          context.exit(() =>
            namespace.run(() => {
              namespace.set("segment", undefined);
              const pending = Promise.resolve()
                .then(() =>
                  client.send(
                    new PutTraceSegmentsCommand({
                      TraceSegmentDocuments: [document],
                    }),
                  ),
                )
                .then((result) => {
                  if (result.UnprocessedTraceSegments?.length) {
                    baseLogger.warn("X-Ray rejected trace segments", {
                      error_codes: result.UnprocessedTraceSegments.map(
                        (segment) => segment.ErrorCode,
                      ),
                    });
                  } else {
                    baseLogger.debug("X-Ray trace exported", {
                      trace_id: segment.trace_id,
                    });
                  }
                })
                .catch((error: unknown) => {
                  baseLogger.warn("X-Ray trace export failed", {
                    error_type:
                      error instanceof Error ? error.name : "UnknownError",
                  });
                })
                .finally(() => {
                  pendingExports.delete(pending);
                });
              pendingExports.add(pending);
            }),
          );
        } catch {
          baseLogger.warn("X-Ray trace serialization failed");
        }
      };
    }

    baseLogger.info("Tracing initialized", {
      tracing_enabled: enabled,
      sample_rate: sampleRate,
      export_transport: enabled
        ? process.env.AWS_LAMBDA_HTTP_ENDPOINT
          ? "xray-api"
          : "xray-sdk"
        : "disabled",
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });

    const originalEmit = Server.prototype.emit;
    Server.prototype.emit = function emit(
      this: Server,
      event: string | symbol,
      ...args: unknown[]
    ) {
      if (event !== "request")
        return Reflect.apply(originalEmit, this, [event, ...args]);
      const [request, response] = args as [IncomingMessage, ServerResponse];
      const requestId = randomUUID();
      const started = performance.now();
      const header =
        typeof request.headers["x-amzn-trace-id"] === "string"
          ? request.headers["x-amzn-trace-id"]
          : "";
      const root = header.match(
        /(?:^|;)\s*Root=(1-[a-f0-9]{8}-[a-f0-9]{24})(?:;|$)/,
      )?.[1];
      const parent = root
        ? header.match(/(?:^|;)\s*Parent=([a-f0-9]{16})(?:;|$)/)?.[1]
        : undefined;
      const segment = enabled
        ? (new HttpRequestSegment(serviceName, root, parent) as RequestSegment)
        : undefined;
      if (segment) {
        segment.notTraced =
          /(?:^|;)\s*Sampled=0(?:;|$)/.test(header) ||
          Math.random() >= sampleRate;
        segment.addAnnotation("Service", serviceName);
        segment.addAnnotation("RequestMethod", request.method || "UNKNOWN");
        segment.addAnnotation(
          "Environment",
          process.env.ENVIRONMENT || "local",
        );
        segment.http = {
          request: { method: request.method, url: `http://${serviceName}/` },
        };
      }
      const requestLogger = baseLogger.createChild({
        persistentLogAttributes: {
          request_id: requestId,
          ...(segment
            ? { trace_id: segment.trace_id, segment_id: segment.id }
            : {}),
        },
      });
      return namespace.runAndReturn(() => {
        namespace.set("segment", segment);
        namespace.bindEmitter(request);
        namespace.bindEmitter(response);
        return context.run(
          { logger: requestLogger, segment, requestId },
          () => {
            response.setHeader("x-request-id", requestId);
            let finished = false;
            const complete = () => {
              if (finished) return;
              finished = true;
              response.removeListener("finish", complete);
              response.removeListener("close", complete);
              const aborted = !response.writableFinished;
              if (segment) {
                segment.http!.response = { status: response.statusCode };
                segment.addAnnotation("ResponseStatus", response.statusCode);
                if (aborted || response.statusCode >= 500)
                  segment.addFaultFlag();
                else if (response.statusCode >= 400) segment.addErrorFlag();
                if (response.statusCode === 429) segment.addThrottleFlag();
                segment.close();
              }
              requestLogger.info("HTTP request completed", {
                method: request.method,
                status: response.statusCode,
                trace_sampled: segment ? !segment.notTraced : false,
                upstream_sampling: header.match(
                  /(?:^|;)\s*Sampled=([01?])(?:;|$)/,
                )?.[1],
                duration_ms:
                  Math.round((performance.now() - started) * 100) / 100,
                aborted,
              });
            };
            response.once("finish", complete);
            response.once("close", complete);
            try {
              return Reflect.apply(originalEmit, this, [event, ...args]);
            } catch (error) {
              segment?.addFaultFlag();
              complete();
              throw error;
            }
          },
        );
      });
    };
  }

  async function traceOperation<Result>(
    name: string,
    operation: (segment?: xray.Subsegment) => Promise<Result>,
  ): Promise<Result> {
    const requestSegment = context.getStore()?.segment;
    if (!requestSegment || requestSegment.notTraced) return operation();
    const parent = xray.getSegment() || requestSegment;
    const segment = parent.addNewSubsegment(name);
    return xray.getNamespace().runAndReturn(async () => {
      xray.setSegment(segment);
      try {
        return await operation(segment);
      } catch (error) {
        segment.addFaultFlag();
        segment.addAnnotation(
          "ErrorType",
          error instanceof Error ? error.name : "UnknownError",
        );
        throw error;
      } finally {
        segment.close();
      }
    });
  }

  function captureAWSv3Client<Client extends TraceableClient>(
    client: Client,
  ): Client {
    tracer.captureAWSv3Client(client);
    const restoreContext: TraceContextMiddleware = (next) => async (args) => {
      const requestSegment = context.getStore()?.segment;
      const active = xray.getSegment();
      const parent = requestSegment
        ? active === requestSegment ||
          (active instanceof xray.Subsegment &&
            active.segment === requestSegment)
          ? active
          : requestSegment
        : active;
      if (!parent) return next(args);
      return xray.getNamespace().runAndReturn(() => {
        xray.setSegment(parent);
        return next(args);
      });
    };
    client.middlewareStack.add(restoreContext, {
      name: "RequestTraceContext",
      step: "initialize",
      override: true,
    });
    return client;
  }

  function recordError(
    ...[error, request, details]: Parameters<Instrumentation.onRequestError>
  ) {
    const segment = context.getStore()?.segment;
    segment?.addFaultFlag();
    segment?.addAnnotation("Route", details.routePath);
    logger.error("Next.js request failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
      method: request.method,
      route: details.routePath,
      routeType: details.routeType,
    });
  }

  return {
    logger,
    tracer,
    context,
    serviceName,
    register,
    recordError,
    traceOperation,
    captureAWSv3Client,
    flush: () => Promise.allSettled([...pendingExports]),
  };
}

const instanceKey = Symbol.for("slongdotexe.observability");
const instances = globalThis as typeof globalThis & {
  [key: symbol]: ReturnType<typeof createObservability> | undefined;
};
const observability = (instances[instanceKey] ||= createObservability());
export const {
  logger,
  tracer,
  context,
  serviceName,
  register,
  recordError,
  traceOperation,
  captureAWSv3Client,
  flush,
} = observability;
export default observability;
