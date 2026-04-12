import assert from 'node:assert/strict'
import test from 'node:test'
import redactTextVersionRevision, {
  REDACTED_REVISION_BODY
} from './redactTextVersionRevision.js'

const buildTextVersionModel = ({
  findResult = [],
  updateResult = { textVersions: [] }
}: {
  findResult?: any[]
  updateResult?: any
}) => {
  const calls = {
    find: [] as any[],
    update: [] as any[]
  }

  const TextVersion = {
    find: async (input: any) => {
      calls.find.push(input)
      return findResult
    },
    update: async (input: any) => {
      calls.update.push(input)
      return updateResult
    }
  } as any

  return { TextVersion, calls }
}

test('redactTextVersionRevision requires a revision ID', async () => {
  const { TextVersion } = buildTextVersionModel({})
  const resolver = redactTextVersionRevision({
    TextVersion,
    revisionType: 'comment'
  })

  await assert.rejects(
    resolver(null, { textVersionId: '' }, {}, {}),
    /Revision ID is required/
  )
})

test('redactTextVersionRevision throws when the revision is missing', async () => {
  const { TextVersion } = buildTextVersionModel({})
  const resolver = redactTextVersionRevision({
    TextVersion,
    revisionType: 'wiki'
  })

  await assert.rejects(
    resolver(null, { textVersionId: 'version-1' }, {}, {}),
    /wiki revision not found/
  )
})

test('redactTextVersionRevision returns an already-redacted revision without updating', async () => {
  const revision = {
    id: 'version-1',
    body: REDACTED_REVISION_BODY
  }
  const { TextVersion, calls } = buildTextVersionModel({
    findResult: [revision]
  })
  const resolver = redactTextVersionRevision({
    TextVersion,
    revisionType: 'discussion body'
  })

  const result = await resolver(null, { textVersionId: 'version-1' }, {}, {})

  assert.equal(result, revision)
  assert.equal(calls.update.length, 0)
})

test('redactTextVersionRevision replaces the body with a deleted marker', async () => {
  const updatedRevision = {
    id: 'version-1',
    body: REDACTED_REVISION_BODY
  }
  const { TextVersion, calls } = buildTextVersionModel({
    findResult: [{ id: 'version-1', body: 'old text' }],
    updateResult: { textVersions: [updatedRevision] }
  })
  const resolver = redactTextVersionRevision({
    TextVersion,
    revisionType: 'comment'
  })

  const result = await resolver(null, { textVersionId: 'version-1' }, {}, {})

  assert.equal(result, updatedRevision)
  assert.deepEqual(calls.update[0].where, { id: 'version-1' })
  assert.deepEqual(calls.update[0].update, { body: REDACTED_REVISION_BODY })
})
