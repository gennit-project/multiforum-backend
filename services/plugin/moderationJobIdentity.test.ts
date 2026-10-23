import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createContentRevisionHash,
  createReportIdempotencyKey,
  createRuleSetVersion,
} from './moderationJobIdentity.js'

const contentInput = {
  channelUniqueName: 'cats',
  contentId: 'discussion-1',
  contentType: 'Discussion' as const,
  title: 'Hello',
  body: 'World',
}

const rulesInput = {
  pluginId: 'auto-moderation',
  pluginVersion: '1.0.0',
  serverRules: ['No spam'],
  forumRules: ['Be kind'],
}

test('content revision changes with content but not identical input', () => {
  const original = createContentRevisionHash(contentInput)

  assert.equal(createContentRevisionHash(contentInput), original)
  assert.notEqual(
    createContentRevisionHash({ ...contentInput, body: 'Updated body' }),
    original
  )
})

test('rule-set version is order-insensitive and changes with policy or plugin version', () => {
  const original = createRuleSetVersion({
    ...rulesInput,
    serverRules: ['No spam', 'No threats'],
  })

  assert.equal(
    createRuleSetVersion({
      ...rulesInput,
      serverRules: ['No threats', 'No spam', 'No spam'],
    }),
    original
  )
  assert.notEqual(
    createRuleSetVersion({ ...rulesInput, forumRules: ['Stay on topic'] }),
    original
  )
  assert.notEqual(
    createRuleSetVersion({ ...rulesInput, pluginVersion: '1.1.0' }),
    original
  )
})

test('report keys distinguish the same discussion in different forums', () => {
  const contentRevisionHash = createContentRevisionHash(contentInput)
  const ruleSetVersion = createRuleSetVersion(rulesInput)
  const common = {
    contentType: 'discussion' as const,
    contentId: 'discussion-1',
    contentRevisionHash,
    ruleSetVersion,
    pluginId: rulesInput.pluginId,
    pluginVersion: rulesInput.pluginVersion,
  }

  assert.notEqual(
    createReportIdempotencyKey({ ...common, channelUniqueName: 'cats' }),
    createReportIdempotencyKey({ ...common, channelUniqueName: 'dogs' })
  )
})
