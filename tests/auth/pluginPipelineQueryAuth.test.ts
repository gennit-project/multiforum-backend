import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { graphql, type GraphQLSchema } from 'graphql'
import type { Driver } from 'neo4j-driver'
import {
  buildPermissionedSchema,
  makeRequestContext,
  type PermissionedSchema,
} from '../helpers/buildPermissionedSchema.js'

let schema: GraphQLSchema
let driver: Driver
let ogm: PermissionedSchema["ogm"]

before(async () => {
  ({ schema, driver, ogm } = await buildPermissionedSchema())
}, { timeout: 120000 })

after(async () => {
  await driver.close()
})

const execute = (source: string) =>
  graphql({
    schema,
    source,
    contextValue: makeRequestContext({ driver, ogm }),
  })

test('anonymous callers cannot enumerate raw plugin run payloads', async () => {
  const result = await execute(`{
    pluginRuns {
      id
      payload
    }
  }`)

  assert.match(result.errors?.[0]?.message || '', /Not Authoris/i)
})

test('anonymous callers cannot use the legacy raw pipeline query', async () => {
  const result = await execute(`{
    getPipelineRuns(targetId: "file-1", targetType: "DownloadableFile") {
      id
      payload
    }
  }`)

  assert.match(
    result.errors?.map(error => error.message).join(' | ') || '',
    /Not Authoris/i
  )
})

test('anonymous callers cannot use the internal pipeline detail query', async () => {
  const result = await execute(`{
    getInternalPluginPipelineRun(pipelineRunId: "attempt-1") {
      jobs {
        payload
      }
    }
  }`)

  assert.match(
    result.errors?.map(error => error.message).join(' | ') || '',
    /Not Authoris/i
  )
})
