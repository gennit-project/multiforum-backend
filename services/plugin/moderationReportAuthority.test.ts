import assert from 'node:assert/strict'
import test from 'node:test'
import type { Driver } from 'neo4j-driver'
import { hasActiveServerBotSuspension } from './moderationReportAuthority.js'

test('mandatory report server suspension query uses scoped identity, leader session and expiration', async () => {
  let closed = 0
  let rows: Array<{ suspendedUntil?: string; suspendedIndefinitely?: boolean }> = []
  const driver = {
    session(config: {database: string; defaultAccessMode?: string}) {
      assert.ok(config.database)
      assert.equal(config.defaultAccessMode, undefined, 'use driver default leader routing')
      return {
        async run(query: string, parameters: unknown) {
          assert.match(query, /serverConfig:ServerConfig/)
          assert.match(query, /SUSPENDED_AS_USER/)
          assert.deepEqual(parameters, {serverName: 'server', username: 'bot-cats-llm-moderator'})
          return {records: rows.map(suspension => ({get: () => suspension}))}
        },
        async close() { closed++ },
      }
    },
  } as unknown as Driver
  const check = () => hasActiveServerBotSuspension(driver, 'server', 'bot-cats-llm-moderator')
  assert.equal(await check(), false)
  rows = [{suspendedUntil: '2000-01-01T00:00:00Z'}]
  assert.equal(await check(), false)
  rows = [{suspendedUntil: '2000-01-01T00:00:00Z', suspendedIndefinitely: true}]
  assert.equal(await check(), true)
  rows = [{suspendedUntil: '2999-01-01T00:00:00Z'}]
  assert.equal(await check(), true)
  assert.equal(closed, 4)
  await assert.rejects(hasActiveServerBotSuspension(driver, '', 'bot'), /Server name is required/)
})

test('server suspension lookup errors fail closed and close the session', async () => {
  let closed = false
  const driver = {session: () => ({run: async () => {throw Error('lookup failed')}, close: async () => {closed = true}})} as unknown as Driver
  await assert.rejects(hasActiveServerBotSuspension(driver, 'server', 'bot'), /lookup failed/)
  assert.equal(closed, true)
})
