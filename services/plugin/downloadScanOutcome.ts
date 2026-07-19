export const SECURITY_SCAN_PLUGIN_ID = 'security-attachment-scan'

export type DownloadScanStatus =
  | 'PENDING'
  | 'CLEAN'
  | 'INFECTED'
  | 'SUSPICIOUS'
  | 'FAILED'

export type DownloadScanOutcome = {
  status: Exclude<DownloadScanStatus, 'PENDING'>
  reason: string | null
}

type ScannerVerdict = 'clean' | 'suspicious' | 'malicious' | 'error'

type ScannerEventResult = {
  success?: boolean
  error?: unknown
  result?: {
    verdict?: unknown
    message?: unknown
    scans?: Array<{
      verdict?: unknown
      summary?: unknown
    }>
  }
}

const VERDICT_TO_STATUS: Record<ScannerVerdict, DownloadScanOutcome['status']> = {
  clean: 'CLEAN',
  suspicious: 'SUSPICIOUS',
  malicious: 'INFECTED',
  error: 'FAILED'
}

const isScannerVerdict = (value: unknown): value is ScannerVerdict =>
  value === 'clean' ||
  value === 'suspicious' ||
  value === 'malicious' ||
  value === 'error'

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const failedDownloadScanOutcome = (reason: unknown): DownloadScanOutcome => ({
  status: 'FAILED',
  reason: asNonEmptyString(reason) || 'The security scan did not complete.'
})

export const resolveDownloadScanOutcome = (
  eventResult: unknown
): DownloadScanOutcome => {
  const scannerResult = eventResult && typeof eventResult === 'object'
    ? eventResult as ScannerEventResult
    : {}
  const verdict = scannerResult.result?.verdict

  if (!isScannerVerdict(verdict)) {
    return failedDownloadScanOutcome(
      scannerResult.error || scannerResult.result?.message
    )
  }

  const status = VERDICT_TO_STATUS[verdict]
  if (status === 'CLEAN') {
    return { status, reason: null }
  }

  const matchingReasons = (scannerResult.result?.scans || [])
    .filter(scan => scan.verdict === verdict)
    .map(scan => asNonEmptyString(scan.summary))
    .filter((reason): reason is string => Boolean(reason))

  return {
    status,
    reason:
      matchingReasons.join(' | ') ||
      asNonEmptyString(scannerResult.error) ||
      asNonEmptyString(scannerResult.result?.message) ||
      'The security scan did not provide a reason.'
  }
}
