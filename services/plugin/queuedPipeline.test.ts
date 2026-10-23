import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseStoredPipelineConfiguration,
  pipelineFromStoredConfiguration,
} from './queuedPipeline.js'

test('rehydrates a stored pipeline in execution order', () => {
  const stored = parseStoredPipelineConfiguration(JSON.stringify({
    event: 'comment.created',
    stopOnFirstFailure: false,
    steps: [
      {
        pluginId: 'second',
        version: '2.0.0',
        order: 1,
        condition: 'PREVIOUS_SUCCEEDED',
        continueOnError: true,
      },
      {
        pluginId: 'first',
        version: '1.0.0',
        order: 0,
        condition: 'ALWAYS',
        continueOnError: false,
      },
    ],
  }))

  assert.ok(stored)
  assert.deepEqual(pipelineFromStoredConfiguration(stored), {
    event: 'comment.created',
    stopOnFirstFailure: false,
    steps: [
      {
        pluginId: 'first',
        version: '1.0.0',
        condition: 'ALWAYS',
        continueOnError: false,
      },
      {
        pluginId: 'second',
        version: '2.0.0',
        condition: 'PREVIOUS_SUCCEEDED',
        continueOnError: true,
      },
    ],
  })
})

test('rejects malformed stored pipeline snapshots', () => {
  const invalidValues = [
    '{',
    null,
    [],
    { event: 42, steps: [] },
    { event: 'comment.created', steps: 'not-an-array' },
    {
      event: 'comment.created',
      steps: [{
        pluginId: 'moderation',
        version: '1.0.0',
        order: 0,
        condition: 'UNKNOWN',
        continueOnError: false,
      }],
    },
    {
      event: 'comment.created',
      steps: [{
        pluginId: 'moderation',
        version: '1.0.0',
        order: 0,
        condition: 'ALWAYS',
        continueOnError: 'no',
      }],
    },
  ]

  for (const value of invalidValues) {
    assert.equal(parseStoredPipelineConfiguration(value), null)
  }
})

test('defaults a missing stop-on-failure flag to enabled', () => {
  assert.deepEqual(parseStoredPipelineConfiguration({
    event: 'discussionChannel.edited',
    steps: [],
  }), {
    event: 'discussionChannel.edited',
    stopOnFirstFailure: true,
    steps: [],
  })
})
