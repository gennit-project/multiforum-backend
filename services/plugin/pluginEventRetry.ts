const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_BASE_MS = 30_000
const DEFAULT_RETRY_MAX_MS = 10 * 60_000

const boundedInteger = ({
  value,
  fallback,
  minimum,
  maximum,
}: {
  value: string | undefined
  fallback: number
  minimum: number
  maximum: number
}) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback
}

export const pluginEventWorkerMaxRetries = () =>
  boundedInteger({
    value: process.env.PLUGIN_EVENT_WORKER_MAX_RETRIES,
    fallback: DEFAULT_MAX_RETRIES,
    minimum: 0,
    maximum: 10,
  })

export const pluginEventWorkerRetryBaseMs = () =>
  boundedInteger({
    value: process.env.PLUGIN_EVENT_WORKER_RETRY_BASE_MS,
    fallback: DEFAULT_RETRY_BASE_MS,
    minimum: 1_000,
    maximum: 60 * 60_000,
  })

export const pluginEventWorkerRetryMaxMs = () =>
  boundedInteger({
    value: process.env.PLUGIN_EVENT_WORKER_RETRY_MAX_MS,
    fallback: DEFAULT_RETRY_MAX_MS,
    minimum: 1_000,
    maximum: 24 * 60 * 60_000,
  })

export type PluginEventRetrySchedule = {
  retryCount: number
  nextAttemptAt: string
  message: string
}

export const createPluginEventRetrySchedule = ({
  retryable,
  currentRetryCount,
  error,
  now = new Date(),
  maxRetries = pluginEventWorkerMaxRetries(),
  baseDelayMs = pluginEventWorkerRetryBaseMs(),
  maxDelayMs = pluginEventWorkerRetryMaxMs(),
}: {
  retryable: boolean
  currentRetryCount: number
  error?: string | null
  now?: Date
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}): PluginEventRetrySchedule | null => {
  if (!retryable || currentRetryCount >= maxRetries) return null

  const retryCount = currentRetryCount + 1
  const delayMs = Math.min(
    maxDelayMs,
    baseDelayMs * (2 ** currentRetryCount)
  )
  const reason = error?.trim() || 'Plugin reported a retryable failure'

  return {
    retryCount,
    nextAttemptAt: new Date(now.getTime() + delayMs).toISOString(),
    message: `${reason} (retry ${retryCount}/${maxRetries} scheduled)`,
  }
}
