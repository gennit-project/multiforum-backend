import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPublicDiagnosticCollector,
  parsePublicDiagnostics,
  sanitizePublicDiagnostic,
  type PublicDiagnosticLevel,
} from './publicDiagnostics.js'

test('accepts and normalizes a safe public diagnostic', () => {
  assert.deepEqual(
    sanitizePublicDiagnostic({
      input: {
        level: 'WARNING',
        code: 'ARCHIVE_CONTAINS_EXECUTABLE',
        message: 'The archive contains an executable file.',
        details: { path: 'setup.exe' },
        helpUrl: 'https://example.com/help/archive-check',
      },
    }),
    {
      level: 'WARNING',
      code: 'ARCHIVE_CONTAINS_EXECUTABLE',
      message: 'The archive contains an executable file.',
      details: { path: 'setup.exe' },
      helpUrl: 'https://example.com/help/archive-check',
    }
  )
})

test('redacts planted secrets, authorization values, and signed URL fields', () => {
  const diagnostic = sanitizePublicDiagnostic({
    secrets: ['scanner-secret'],
    input: {
      level: 'ERROR',
      code: 'SCAN_PROVIDER_ERROR',
      message: 'Bearer abc123 scanner-secret',
      details: {
        apiToken: 'visible-looking-token',
        nested: {
          url: 'https://storage.example/file?X-Goog-Signature=signed-value&safe=yes',
          note: 'scanner-secret',
        },
      },
      helpUrl: 'https://example.com/help?token=scanner-secret&topic=scan',
    },
  })

  assert.deepEqual(diagnostic, {
    level: 'ERROR',
    code: 'SCAN_PROVIDER_ERROR',
    message: 'Bearer [REDACTED] [REDACTED]',
    details: {
      apiToken: '[REDACTED]',
      nested: {
        url: 'https://storage.example/file?X-Goog-Signature=%5BREDACTED%5D&safe=yes',
        note: '[REDACTED]',
      },
    },
    helpUrl:
      'https://example.com/help?token=%5BREDACTED%5D&topic=scan',
  })
})

test('rejects unstable diagnostic codes and unsafe help URL schemes', () => {
  assert.throws(
    () =>
      sanitizePublicDiagnostic({
        input: {
          level: 'INFO',
          code: 'not-stable',
          message: 'Message',
          helpUrl: 'javascript:alert(1)',
        },
      }),
    /code/
  )
})

test('bounds diagnostic count and detail size', () => {
  const collector = createPublicDiagnosticCollector()
  assert.throws(
    () =>
      collector.public({
        level: 'INFO',
        code: 'DETAIL_TOO_LARGE',
        message: 'Message',
        details: { value: 'x'.repeat(9000) },
      }),
    /8192/
  )
})

test('collects diagnostics without exposing the supplied secrets', () => {
  const collector = createPublicDiagnosticCollector({
    secrets: ['private-value'],
  })
  collector.public({
    level: 'INFO',
    code: 'SCAN_COMPLETE',
    message: 'Result private-value',
  })

  assert.equal(
    JSON.stringify(collector.entries).includes('private-value'),
    false
  )
})

test('limits the number of diagnostics produced by one job', () => {
  const collector = createPublicDiagnosticCollector()
  for (let index = 0; index < 50; index += 1) {
    collector.public({
      level: 'INFO',
      code: `RESULT_${index}`,
      message: 'Result',
    })
  }

  assert.throws(
    () =>
      collector.public({
        level: 'INFO',
        code: 'ONE_TOO_MANY',
        message: 'Result',
      }),
    /at most 50/
  )
})

test('rejects non-http help links', () => {
  assert.throws(
    () =>
      sanitizePublicDiagnostic({
        input: {
          level: 'INFO',
          code: 'UNSAFE_HELP_LINK',
          message: 'Message',
          helpUrl: 'javascript:alert(1)',
        },
      }),
    /HTTP/
  )
})

test('rejects unsupported levels and empty messages', () => {
  assert.deepEqual(
    [
      () =>
        sanitizePublicDiagnostic({
          input: {
            level: 'DEBUG' as unknown as PublicDiagnosticLevel,
            code: 'DEBUG_RESULT',
            message: 'Message',
          },
        }),
      () =>
        sanitizePublicDiagnostic({
          input: {
            level: 'INFO',
            code: 'EMPTY_MESSAGE',
            message: '',
          },
        }),
    ].map(operation => {
      try {
        operation()
        return 'accepted'
      } catch (error) {
        return (error as Error).message
      }
    }),
    [
      'Public diagnostic level must be INFO, WARNING, or ERROR',
      'Public diagnostic message must be 1-1000 characters',
    ]
  )
})

test('sanitizes arrays, non-json values, and circular references', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const diagnostic = sanitizePublicDiagnostic({
    input: {
      level: 'INFO',
      code: 'COMPLEX_DETAILS',
      message: 'Message',
      details: [
        null,
        true,
        2,
        undefined,
        circular,
      ],
    },
  })

  assert.deepEqual(diagnostic.details, [
    null,
    true,
    2,
    'undefined',
    { self: '[REDACTED: circular value]' },
  ])
})

test('parses already-materialized arrays and ignores non-array storage', () => {
  const entries = [
    { level: 'INFO', code: 'RESULT_OK', message: 'Done' },
  ]
  assert.deepEqual(
    {
      array: parsePublicDiagnostics(entries),
      object: parsePublicDiagnostics('{"code":"RESULT_OK"}'),
      null: parsePublicDiagnostics(null),
    },
    {
      array: entries,
      object: [],
      null: [],
    }
  )
})

test('parses stored arrays and fails closed for malformed storage', () => {
  assert.deepEqual(
    {
      parsed: parsePublicDiagnostics(
        JSON.stringify([{ level: 'INFO', code: 'OK', message: 'Done' }])
      ),
      malformed: parsePublicDiagnostics('{'),
    },
    {
      parsed: [{ level: 'INFO', code: 'OK', message: 'Done' }],
      malformed: [],
    }
  )
})
