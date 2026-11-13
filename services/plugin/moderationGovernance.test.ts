import assert from 'node:assert/strict'
import test from 'node:test'
import { isChannelRuleEligible } from './moderationGovernance.js'

test('channel eligibility preserves legacy defaults and fails closed for malformed new policy', () => {
  for (const settings of [{}, { serverRuleCheckMode: 'allowlist' }, { channelRuleEligibility: 'all' }, { channelRuleEligibility: 'allowlist', channelRuleAllowlist: ['cats'] }]) {
    assert.equal(isChannelRuleEligible(settings, 'cats'), true)
  }
  for (const settings of [{ channelRuleEligibility: 'none' }, { channelRuleEligibility: null }, { channelRuleEligibility: 'invalid' }, { channelRuleEligibility: 'allowlist' }, { channelRuleEligibility: 'allowlist', channelRuleAllowlist: ['cats', 1] }, { channelRuleEligibility: 'allowlist', channelRuleAllowlist: ['dogs'] }]) {
    assert.equal(isChannelRuleEligible(settings, 'cats'), false)
  }
  assert.equal(isChannelRuleEligible({ server: { channelRuleEligibility: 'none' } }, 'cats'), false)
  assert.equal(isChannelRuleEligible({ channelRuleEligibility: 'none', server: { channelRuleEligibility: 'all' } }, 'cats'), false)
})

test('server moderation authority uses server pins and runs before channel steps', async () => {
  const { protectServerModerationStep, getServerModerationSettings } = await import('./moderationGovernance.js')
  const makeEdge = (version: string, settings: unknown) => ({
    properties: { enabled: true, settingsJson: settings },
    node: { id: version, version, repoUrl: '', entryPath: '', manifest: { events: ['comment.created'] }, settingsDefaults: {}, uiSchema: {}, Plugin: { id: 'p', name: 'llm-moderation', metadata: {} } },
  })
  const current = makeEdge('2.0.0', { serverRuleEnforcement: 'on', channelRuleEligibility: 'none' })
  const old = makeEdge('1.0.0', {})
  const pluginVersionsMap = new Map([['llm-moderation', [{ version: '2.0.0', edgeData: current }, { version: '1.0.0', edgeData: old }]]])
  const serverPipeline = { event: 'comment.created', steps: [{ pluginId: 'llm-moderation', version: '2.0.0' }] }
  const result = protectServerModerationStep({
    pluginVersionsMap, serverPipeline, event: 'comment.created', pluginsToRun: [
      { pluginId: 'other', edgeData: old, step: { pluginId: 'other' }, order: 0 },
      { pluginId: 'llm-moderation', edgeData: old, step: { pluginId: 'llm-moderation', condition: 'PREVIOUS_FAILED' }, order: 1 },
    ],
  })
  const missingPin = protectServerModerationStep({ pluginVersionsMap, serverPipeline: { ...serverPipeline, steps: [{ pluginId: 'llm-moderation', version: '9.9.9' }] }, event: 'comment.created', pluginsToRun: [] })
  assert.equal(missingPin[0].edgeData.node.version, '2.0.0', 'missing server pin must not suppress mandatory enforcement')
  assert.equal(result[0].edgeData.node.version, '2.0.0')
  assert.equal(result[0].step.condition, 'ALWAYS')
  assert.deepEqual(result.map(step => step.order), [0, 1])
  assert.equal(isChannelRuleEligible(getServerModerationSettings(pluginVersionsMap, serverPipeline), 'cats'), false)
  assert.equal(protectServerModerationStep({ pluginVersionsMap, serverPipeline, event: 'comment.created', pluginsToRun: [] }).length, 1)
  current.properties.settingsJson = { serverRuleCheckMode: 'allowlist' }
  assert.equal(protectServerModerationStep({ pluginVersionsMap, serverPipeline, event: 'comment.created', pluginsToRun: [] }).length, 0, 'legacy pipeline selection remains unchanged')
})

test('latest installed policy controls eligibility and pinned runtime settings', async () => {
  const { applyServerModerationPolicy, getServerModerationSettings, protectServerModerationStep } = await import('./moderationGovernance.js')
  const edge = (version: string, settingsJson: unknown) => ({
    properties: { enabled: true, settingsJson },
    node: { id: version, version, repoUrl: '', entryPath: '', manifest: { events: ['comment.created'] }, settingsDefaults: {}, uiSchema: {}, Plugin: { id: 'p', name: 'llm-moderation', metadata: {} } },
  })
  const old = edge('1.0.0', { serverRuleEnforcement: 'off', channelRuleEligibility: 'all' })
  const current = edge('2.0.0', { serverRuleEnforcement: 'on', channelRuleEligibility: 'none' })
  const pluginVersionsMap = new Map([['llm-moderation', [{ version: '2.0.0', edgeData: current }, { version: '1.0.0', edgeData: old }]]])
  const serverPipeline = { event: 'comment.created', steps: [{ pluginId: 'llm-moderation', version: '1.0.0' }] }
  const policy = getServerModerationSettings(pluginVersionsMap, serverPipeline)
  assert.equal(isChannelRuleEligible(policy, 'cats'), false)
  const runs = protectServerModerationStep({ pluginVersionsMap, serverPipeline, event: 'comment.created', pluginsToRun: [] })
  assert.equal(runs[0].edgeData.node.version, '1.0.0', 'server pin still selects implementation')
  assert.deepEqual(applyServerModerationPolicy(old.properties.settingsJson, policy), current.properties.settingsJson)
  assert.equal(isChannelRuleEligible({ channelRuleEligibility: 'allowlist', channelRuleAllowlist: [] }, 'cats'), false)
  assert.equal(isChannelRuleEligible({ channelRuleEligibility: 'allowlist', channelRuleAllowlist: ['', ' cats ', 'cats', '  '] }, 'cats'), true)
  assert.equal(isChannelRuleEligible({ channelRuleEligibility: 'allowlist', channelRuleAllowlist: ['Cats'] }, 'cats'), false)
})

test('absent authority cannot inherit governance from an older pinned version or defaults', async () => {
  const { applyServerModerationPolicy } = await import('./moderationGovernance.js')
  assert.equal(isChannelRuleEligible({ channelRuleEligibility: undefined }, 'cats'), false)
  const runtime = { serverRuleEnforcement: 'on', channelRuleEligibility: 'all', server: { serverRuleEnforcement: 'on', serverRuleCheckMode: 'allowlist' } }
  assert.deepEqual(applyServerModerationPolicy(runtime, {}), { server: {} })
  assert.equal(runtime.server.serverRuleEnforcement, 'on', 'do not mutate shared defaults')
})

test('new policy never executes a legacy implementation, including explicit off', async () => {
  const { protectServerModerationStep, supportsModerationPolicy } = await import('./moderationGovernance.js')
  const settings = { serverRuleEnforcement: 'off', channelRuleEligibility: 'none' }
  assert.equal(supportsModerationPolicy('0.7.1', settings), false)
  assert.equal(supportsModerationPolicy('0.8.0', settings), true)
  assert.equal(supportsModerationPolicy('0.7.1', { serverRuleCheckMode: 'off' }), true)
  const edge = (version: string) => ({
    properties: { enabled: true, settingsJson: settings },
    node: { id: version, version, repoUrl: '', entryPath: '', manifest: { events: ['comment.created'] }, settingsDefaults: {}, uiSchema: {}, Plugin: { id: 'p', name: 'llm-moderation', metadata: {} } },
  })
  const old = edge('0.7.1')
  const current = edge('0.8.0')
  const pluginsToRun = [{ pluginId: 'llm-moderation', edgeData: old, step: { pluginId: 'llm-moderation', version: '0.7.1' }, order: 0 }]
  const pluginVersionsMap = new Map([['llm-moderation', [{ version: '0.7.1', edgeData: old }]]])
  const input = { pluginVersionsMap, pluginsToRun, serverPipeline: undefined, event: 'comment.created' }
  assert.deepEqual(protectServerModerationStep(input), [])
  pluginVersionsMap.set('llm-moderation', [{ version: '0.8.0', edgeData: current }, { version: '0.7.1', edgeData: old }])
  assert.equal(protectServerModerationStep(input)[0].edgeData.node.version, '0.8.0')
})

test('modern owner state belongs to the authority version while legacy state stays version-specific', async () => {
  const { getModerationOwnerStateVersionId } = await import('./moderationGovernance.js')
  const edgeData = {
    properties: { enabled: true, settingsJson: { channelRuleEligibility: 'all' } as unknown },
    node: { id: 'latest', version: '0.9.0', repoUrl: '', entryPath: '', manifest: {}, settingsDefaults: {}, uiSchema: {}, Plugin: { id: 'p', name: 'llm-moderation', metadata: {} } },
  }
  const versions = new Map([['llm-moderation', [{ version: '0.9.0', edgeData }]]])
  assert.equal(getModerationOwnerStateVersionId(versions, 'pinned'), 'latest')
  edgeData.properties.settingsJson = { serverRuleCheckMode: 'all_forums' }
  assert.equal(getModerationOwnerStateVersionId(versions, 'pinned'), 'pinned')
})

test('server scope is independent of eligibility and preserves legacy staged lists', async () => {
  const { serverRulesApply, serverRuleScope, applyServerModerationPolicy } = await import('./moderationGovernance.js')
  for (const eligibility of ['all', 'none', 'allowlist']) {
    for (const mode of ['on', 'off', 'allowlist']) {
      const settings = {serverRuleEnforcement: mode, serverRuleForumAllowlist: [' cats '], channelRuleEligibility: eligibility, channelRuleAllowlist: ['dogs']}
      assert.equal(serverRulesApply(settings, 'cats'), mode !== 'off')
      assert.equal(serverRulesApply(settings, 'dogs'), mode === 'on')
      assert.equal(serverRulesApply(settings, ''), mode === 'on')
    }
  }
  for (const list of [['cats'], '["cats"]', 'cats,dogs']) {
    const settings = {server: {serverRuleCheckMode: 'allowlist', serverRuleForumAllowlist: list}}
    assert.equal(serverRuleScope(settings), 'allowlist')
    assert.equal(serverRulesApply(settings, 'cats'), true)
    assert.equal(serverRulesApply(settings, 'other'), false)
  }
  assert.equal(serverRulesApply({serverRuleCheckMode:'on'},'cats'),false)
  assert.equal(serverRulesApply({serverRuleCheckMode:'allowlist',serverRuleForumAllowlist:['cats',1]},'cats'),true)
  assert.equal(serverRulesApply({serverRuleEnforcement:'allowlist',serverRuleForumAllowlist:['cats',1]},'cats'),false)
  const authority = {serverRuleEnforcement:'allowlist',serverRuleForumAllowlist:['cats'],channelRuleEligibility:'none'}
  const effective = applyServerModerationPolicy({serverRuleEnforcement:'on',serverRuleForumAllowlist:['dogs'],server:{serverRuleCheckMode:'all_forums'}},authority)
  assert.equal(serverRulesApply(effective,'dogs'),false)
  assert.equal(serverRulesApply(effective,'cats'),true)
})
