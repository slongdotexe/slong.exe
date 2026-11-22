import { trace } from '@opentelemetry/api'

export function GET(request: Request) {
  const span = trace.getActiveSpan()?.spanContext()

  return Response.json(
    {
      traceparent: request.headers.get('traceparent'),
      xAmznTraceId: request.headers.get('x-amzn-trace-id'),
      traceId: span?.traceId ?? null,
      spanId: span?.spanId ?? null,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
