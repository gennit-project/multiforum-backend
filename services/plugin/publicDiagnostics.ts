export type PublicDiagnosticLevel = 'INFO' | 'WARNING' | 'ERROR'

export type PublicDiagnosticInput = {
  level: PublicDiagnosticLevel
  code: string
  message: string
  details?: unknown
  helpUrl?: string
}

export type PublicDiagnostic = {
  level: PublicDiagnosticLevel
  code: string
  message: string
  details: unknown | null
  helpUrl: string | null
}

const MAX_DIAGNOSTICS = 50
const MAX_MESSAGE_LENGTH = 1000
const MAX_DETAILS_BYTES = 8192
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/
const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|credential|password|private.?key|secret|signature|token/i
const SENSITIVE_QUERY_KEY_PATTERN =
  /authorization|credential|password|secret|signature|token|x-goog-/i
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

const redactUrl = (value: string): string => {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, '[REDACTED]')
      }
    }
    return url.toString()
  } catch {
    return value
  }
}

const redactString = (value: string, secrets: string[]): string => {
  let redacted = value.replace(BEARER_PATTERN, 'Bearer [REDACTED]')
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redactUrl(redacted)
}

const sanitizeValue = (
  value: unknown,
  secrets: string[],
  seen = new WeakSet<object>()
): unknown => {
  if (typeof value === 'string') return redactString(value, secrets)
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, secrets, seen))
  }
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[REDACTED: circular value]'

  seen.add(value)
  const sanitized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitizeValue(child, secrets, seen)
  }
  seen.delete(value)
  return sanitized
}

const serializedByteLength = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8')

export const sanitizePublicDiagnostic = ({
  input,
  secrets = [],
}: {
  input: PublicDiagnosticInput
  secrets?: string[]
}): PublicDiagnostic => {
  if (!['INFO', 'WARNING', 'ERROR'].includes(input.level)) {
    throw new Error('Public diagnostic level must be INFO, WARNING, or ERROR')
  }
  if (!CODE_PATTERN.test(input.code)) {
    throw new Error(
      'Public diagnostic code must be 3-64 uppercase letters, numbers, or underscores'
    )
  }
  if (!input.message || input.message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(
      `Public diagnostic message must be 1-${MAX_MESSAGE_LENGTH} characters`
    )
  }

  const details =
    input.details === undefined
      ? null
      : sanitizeValue(input.details, secrets)
  if (serializedByteLength(details) > MAX_DETAILS_BYTES) {
    throw new Error(
      `Public diagnostic details must not exceed ${MAX_DETAILS_BYTES} bytes`
    )
  }

  let helpUrl: string | null = null
  if (input.helpUrl) {
    const parsed = new URL(input.helpUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Public diagnostic helpUrl must use HTTP or HTTPS')
    }
    helpUrl = redactString(input.helpUrl, secrets)
  }

  return {
    level: input.level,
    code: input.code,
    message: redactString(input.message, secrets),
    details,
    helpUrl,
  }
}

export const createPublicDiagnosticCollector = ({
  secrets = [],
}: {
  secrets?: string[]
} = {}) => {
  const entries: PublicDiagnostic[] = []

  return {
    entries,
    public(input: PublicDiagnosticInput) {
      if (entries.length >= MAX_DIAGNOSTICS) {
        throw new Error(
          `A plugin run may publish at most ${MAX_DIAGNOSTICS} diagnostics`
        )
      }
      const diagnostic = sanitizePublicDiagnostic({ input, secrets })
      entries.push(diagnostic)
      return diagnostic
    },
  }
}

export const parsePublicDiagnostics = (value: unknown): PublicDiagnostic[] => {
  if (Array.isArray(value)) return value as PublicDiagnostic[]
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as PublicDiagnostic[] : []
  } catch {
    return []
  }
}
