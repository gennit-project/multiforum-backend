import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { renderProductionPluginConfiguration } from './renderProductionPluginConfiguration.js'

const template = JSON.parse(
  await readFile(new URL('../deployment/plugin-configuration/production.template.json', import.meta.url), 'utf8')
) as unknown

const render = () => renderProductionPluginConfiguration(template, {
  scanServiceUrl: 'https://scanner.example.test',
  moderationServiceUrl: 'https://moderation.example.test/',
  trialForum: 'moderation_trial',
})

test('renders the complete production plugin topology without secret values', () => {
  const manifest = render() as {
    plugins: Array<{ pluginId: string; settingsJson: Record<string, unknown> }>
    channelPlugins: Array<{ channelUniqueName: string }>
    pipelines: Array<{ event: string }>
  }
  assert.deepEqual(manifest.plugins.map(plugin => plugin.pluginId), [
    'security-attachment-scan',
    'llm-moderation',
  ])
  assert.deepEqual(manifest.pipelines.map(pipeline => pipeline.event), [
    'downloadableFile.created',
    'downloadableFile.updated',
    'downloadableFile.downloaded',
    'comment.created',
    'comment.edited',
    'discussionChannel.created',
    'discussionChannel.edited',
  ])
  assert.equal(manifest.channelPlugins[0].channelUniqueName, 'moderation_trial')
  assert.equal(manifest.plugins[1].settingsJson.serviceUrl, 'https://moderation.example.test')
  const serialized = JSON.stringify(manifest)
  assert.doesNotMatch(serialized, /secret-value|MOD_PROVIDER_API_KEY/)
  assert.match(serialized, /env:SCAN_API_KEY/)
  assert.match(serialized, /env:MOD_API_KEY/)
})

test('rejects unsafe service URLs and invalid forum names', () => {
  for (const scanServiceUrl of [
    'http://scanner.example.test',
    'https://user:pass@scanner.example.test',
    'https://scanner.example.test/path',
  ]) {
    assert.throws(() => renderProductionPluginConfiguration(template, {
      scanServiceUrl,
      moderationServiceUrl: 'https://moderation.example.test',
      trialForum: 'moderation_trial',
    }), /HTTPS origin/)
  }
  assert.throws(() => renderProductionPluginConfiguration(template, {
    scanServiceUrl: 'https://scanner.example.test',
    moderationServiceUrl: 'https://moderation.example.test',
    trialForum: 'not a channel',
  }), /channel unique name/)
})

test('rejects unresolved template tokens', () => {
  assert.throws(() => renderProductionPluginConfiguration({ value: '__UNKNOWN__' }, {
    scanServiceUrl: 'https://scanner.example.test',
    moderationServiceUrl: 'https://moderation.example.test',
    trialForum: 'moderation_trial',
  }), /unresolved template token/)
})
