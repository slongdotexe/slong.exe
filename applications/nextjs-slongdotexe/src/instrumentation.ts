import type { Instrumentation } from 'next'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const configured = process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS?.trim()
  const disabled = configured
    ? configured
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : ['fs', 'dns']
  const finalDisabled = [...disabled, 'http']

  console.log({ message: 'Packages disabled for ADOT instrumentation', disabled: finalDisabled })
  process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS = [...new Set(finalDisabled)].join(',')
  await import('@aws/aws-distro-opentelemetry-node-autoinstrumentation/register')
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { logger } = await import('./utils/logger')
  logger.error('Next.js request failed', {
    error,
    errorType: error instanceof Error ? error.name : 'UnknownError',
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
  })
}
