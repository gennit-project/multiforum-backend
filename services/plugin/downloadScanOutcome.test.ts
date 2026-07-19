import assert from 'node:assert/strict'
import test from 'node:test'
import {
  failedDownloadScanOutcome,
  resolveDownloadScanOutcome
} from './downloadScanOutcome.js'

test('maps a clean verdict to an available scan status without a reason', () => {
  assert.deepEqual(
    resolveDownloadScanOutcome({
      success: true,
      result: { verdict: 'clean', scans: [{ verdict: 'clean', summary: 'No threats' }] }
    }),
    { status: 'CLEAN', reason: null }
  )
})

test('maps suspicious content and keeps only matching creator-safe summaries', () => {
  assert.deepEqual(
    resolveDownloadScanOutcome({
      success: true,
      result: {
        verdict: 'suspicious',
        scans: [
          { verdict: 'clean', summary: 'First file passed' },
          { verdict: 'suspicious', summary: 'Archive contains an installer' }
        ]
      }
    }),
    { status: 'SUSPICIOUS', reason: 'Archive contains an installer' }
  )
})

test('maps malicious content to infected', () => {
  assert.deepEqual(
    resolveDownloadScanOutcome({
      success: false,
      error: 'Attachment scan blocked upload',
      result: {
        verdict: 'malicious',
        scans: [{ verdict: 'malicious', summary: 'Known malware signature' }]
      }
    }),
    { status: 'INFECTED', reason: 'Known malware signature' }
  )
})

test('maps a scanner error verdict to a server-side failure', () => {
  assert.deepEqual(
    resolveDownloadScanOutcome({
      success: false,
      result: {
        verdict: 'error',
        scans: [{ verdict: 'error', summary: 'Scan service unreachable' }]
      }
    }),
    { status: 'FAILED', reason: 'Scan service unreachable' }
  )
})

test('fails closed when the scanner does not return a recognized verdict', () => {
  assert.deepEqual(
    resolveDownloadScanOutcome({ success: true, result: { message: 'Done' } }),
    { status: 'FAILED', reason: 'Done' }
  )
})

test('normalizes thrown scanner failures', () => {
  assert.deepEqual(
    failedDownloadScanOutcome('Plugin loader failed'),
    { status: 'FAILED', reason: 'Plugin loader failed' }
  )
})
