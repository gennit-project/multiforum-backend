import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphql } from 'graphql'
import { buildPermissionedSchema, makeRequestContext } from '../helpers/buildPermissionedSchema.js'

test('anonymous callers cannot inspect plugin configuration status', { timeout: 120000 }, async () => {
  const { schema, driver, ogm } = await buildPermissionedSchema()
  try {
    const result = await graphql({ schema, source: `{ getPluginConfigStatus(pluginId: "synthetic", version: "1") { isFullyConfigured } }`, contextValue: { ...makeRequestContext({ driver, ogm }), permissionServerConfigRepository: { findByName: async () => ({ DefaultServerRole: { canManagePlugins: true } }) } } })
    assert.match(result.errors?.map(error => error.message).join(' | ') || '', /Not Authoris/i)
  } finally { await driver.close() }
})
