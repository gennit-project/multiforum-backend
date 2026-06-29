import assert from 'node:assert/strict'
import test from 'node:test'
import { getPluginVersionCompatibility } from './compatibility.js'

test('getPluginVersionCompatibility allows versions without compatibility metadata', () => {
  assert.deepEqual(getPluginVersionCompatibility({}), { compatible: true })
})

test('getPluginVersionCompatibility rejects versions requiring a newer server', () => {
  const result = getPluginVersionCompatibility(
    { minServerVersion: '2.0.0' },
    { currentServerVersion: '1.0.0' }
  )

  assert.equal(result.compatible, false)
  if (!result.compatible) {
    assert.equal(result.code, 'PLUGIN_VERSION_REQUIRES_NEWER_SERVER')
    assert.match(result.message, /Requires server >= 2\.0\.0/)
  }
})

test('getPluginVersionCompatibility rejects unsupported plugin API versions', () => {
  const result = getPluginVersionCompatibility(
    { apiVersion: '2' },
    { supportedPluginApiVersion: '1' }
  )

  assert.equal(result.compatible, false)
  if (!result.compatible) {
    assert.equal(result.code, 'PLUGIN_API_VERSION_UNSUPPORTED')
    assert.match(result.message, /Requires plugin API 2/)
  }
})

test('getPluginVersionCompatibility accepts matching compatibility metadata', () => {
  assert.deepEqual(
    getPluginVersionCompatibility(
      { minServerVersion: '1.0.0', apiVersion: '1' },
      { currentServerVersion: '1.0.0', supportedPluginApiVersion: '1' }
    ),
    { compatible: true }
  )
})
