import { trace } from '@opentelemetry/api'
import { connection } from 'next/server'
import { Suspense } from 'react'

type TraceResponse = {
  traceparent: string | null
  xAmznTraceId: string | null
  traceId: string | null
  spanId: string | null
}

async function TraceDemo() {
  await connection()

  const upstream = trace.getActiveSpan()?.spanContext()
  const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? `127.0.0.1:${process.env.PORT ?? '3000'}`
  const response = await fetch(`http://${endpoint}/api/trace-demo`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Trace demo API returned ${response.status}`)
  const downstream: TraceResponse = await response.json()

  const fields = [
    ['Render trace ID', upstream?.traceId],
    ['Render span ID', upstream?.spanId],
    ['API trace ID', downstream.traceId],
    ['API span ID', downstream.spanId],
    ['Received traceparent', downstream.traceparent],
    ['Received X-Amzn-Trace-Id', downstream.xAmznTraceId],
    [
      'Trace IDs match',
      upstream?.traceId && downstream.traceId ? String(upstream.traceId === downstream.traceId) : null,
    ],
  ]

  return (
    <dl className="space-y-5 border-t-2 border-emerald-600 py-6">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt className="text-sm text-zinc-500 dark:text-zinc-400">{label}</dt>
          <dd className="mt-1 break-all font-mono text-sm">{value ?? 'Not available'}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function TraceDemoPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16 font-sans sm:px-10">
      <header className="mb-10">
        <p className="mb-3 font-mono text-sm text-emerald-700 dark:text-emerald-400">slongdotexe / Next.js</p>
        <h1 className="text-3xl font-semibold">Trace propagation</h1>
      </header>
      <Suspense fallback={<p role="status">Loading trace...</p>}>
        <TraceDemo />
      </Suspense>
    </main>
  )
}
