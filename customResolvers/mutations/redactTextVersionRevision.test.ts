import assert from 'node:assert/strict'
import test from 'node:test'
import type { Driver } from 'neo4j-driver'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import redactTextVersionRevision, {
  assertCanRedactRevision,
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

const buildDriver = (
  target: Record<string, any> | null = {
    targetType: 'comment',
    targetId: 'comment-1',
    ownerUsername: 'alice',
    ownerModProfileName: null,
    channelUniqueName: 'cats'
  }
) => {
  const calls = {
    run: [] as any[],
    close: 0
  }

  const records = target
    ? [
        {
          get: (key: string) => target[key]
        }
      ]
    : []

  const driver = {
    session: () => ({
      run: async (...args: any[]) => {
        calls.run.push(args)
        return { records }
      },
      close: () => {
        calls.close += 1
      }
    })
  }

  return { driver: driver as unknown as Driver, calls }
}

const buildResolverInput = ({
  TextVersion,
  driver,
  revisionType = 'comment',
  checkModPermissions = async () => true,
  getServerMembership = async () => ({
    isServerAdmin: false,
    isServerModerator: false
  })
}: {
  TextVersion: any
  driver: any
  revisionType?: 'comment' | 'discussion body' | 'wiki'
  checkModPermissions?: any
  getServerMembership?: any
}) => ({
  TextVersion,
  driver,
  revisionType,
  checkModPermissions,
  getServerMembership
})

test('redactTextVersionRevision requires a revision ID', async () => {
  const { TextVersion } = buildTextVersionModel({})
  const { driver } = buildDriver()
  const resolver = redactTextVersionRevision({
    TextVersion,
    driver,
    revisionType: 'comment'
  })

  await assert.rejects(
    resolver(null, { textVersionId: '' }, {} as unknown as GraphQLContext, {} as unknown as GraphQLResolveInfo),
    /Revision ID is required/
  )
})

test('redactTextVersionRevision throws when the revision is missing', async () => {
  const { TextVersion } = buildTextVersionModel({})
  const { driver } = buildDriver()
  const resolver = redactTextVersionRevision({
    TextVersion,
    driver,
    revisionType: 'wiki'
  })

  await assert.rejects(
    resolver(null, { textVersionId: 'version-1' }, {} as unknown as GraphQLContext, {} as unknown as GraphQLResolveInfo),
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
  const { driver } = buildDriver({
    targetType: 'discussion body',
    targetId: 'discussion-1',
    ownerUsername: 'alice',
    ownerModProfileName: null,
    channelUniqueName: 'cats'
  })
  const resolver = redactTextVersionRevision(buildResolverInput({
    TextVersion,
    driver,
    revisionType: 'discussion body'
  }))

  const result = await resolver(
    null,
    { textVersionId: 'version-1' },
    { user: { username: 'alice', data: { ModerationProfile: null } } } as unknown as GraphQLContext,
    {} as unknown as GraphQLResolveInfo
  )

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
  const { driver } = buildDriver()
  const resolver = redactTextVersionRevision(buildResolverInput({
    TextVersion,
    driver,
    revisionType: 'comment'
  }))

  const result = await resolver(
    null,
    { textVersionId: 'version-1' },
    { user: { username: 'alice', data: { ModerationProfile: null } } } as unknown as GraphQLContext,
    {} as unknown as GraphQLResolveInfo
  )

  assert.equal(result, updatedRevision)
  assert.deepEqual(calls.update[0].where, { id: 'version-1' })
  assert.deepEqual(calls.update[0].update, { body: REDACTED_REVISION_BODY })
})

test('redactTextVersionRevision lets a moderator with the edit permission redact a discussion revision', async () => {
  const updatedRevision = {
    id: 'version-1',
    body: REDACTED_REVISION_BODY
  }
  const { TextVersion, calls } = buildTextVersionModel({
    findResult: [{ id: 'version-1', body: 'old text' }],
    updateResult: { textVersions: [updatedRevision] }
  })
  const { driver } = buildDriver({
    targetType: 'discussion body',
    targetId: 'discussion-1',
    ownerUsername: 'alice',
    ownerModProfileName: null,
    channelUniqueName: 'cats'
  })
  const permissionCalls: any[] = []
  const resolver = redactTextVersionRevision(
    buildResolverInput({
      TextVersion,
      driver,
      revisionType: 'discussion body',
      checkModPermissions: async (input: any) => {
        permissionCalls.push(input)
        return true
      }
    })
  )

  await resolver(
    null,
    { textVersionId: 'version-1' },
    { user: { username: 'mod', data: { ModerationProfile: { displayName: 'mod-cats' } } } } as unknown as GraphQLContext,
    {} as unknown as GraphQLResolveInfo
  )

  assert.equal(calls.update.length, 1)
  assert.deepEqual(permissionCalls[0].channelConnections, ['cats'])
  assert.equal(permissionCalls[0].permissionCheck, 'canEditDiscussions')
})

test('redactTextVersionRevision uses the wiki delete permission for wiki revisions', async () => {
  const updatedRevision = {
    id: 'version-1',
    body: REDACTED_REVISION_BODY
  }
  const { TextVersion, calls } = buildTextVersionModel({
    findResult: [{ id: 'version-1', body: 'old text' }],
    updateResult: { textVersions: [updatedRevision] }
  })
  const { driver } = buildDriver({
    targetType: 'wiki',
    targetId: 'wiki-1',
    ownerUsername: 'alice',
    ownerModProfileName: null,
    channelUniqueName: 'cats'
  })
  const permissionCalls: any[] = []
  const resolver = redactTextVersionRevision(
    buildResolverInput({
      TextVersion,
      driver,
      revisionType: 'wiki',
      checkModPermissions: async (input: any) => {
        permissionCalls.push(input)
        return true
      }
    })
  )

  await resolver(
    null,
    { textVersionId: 'version-1' },
    { user: { username: 'mod', data: { ModerationProfile: { displayName: 'mod-cats' } } } } as unknown as GraphQLContext,
    {} as unknown as GraphQLResolveInfo
  )

  assert.equal(calls.update.length, 1)
  assert.deepEqual(permissionCalls[0].channelConnections, ['cats'])
  assert.equal(permissionCalls[0].permissionCheck, 'canDeleteWiki')
})

test('redactTextVersionRevision rejects mismatched revision types', async () => {
  const { TextVersion } = buildTextVersionModel({
    findResult: [{ id: 'version-1', body: 'old text' }]
  })
  const { driver } = buildDriver({
    targetType: 'wiki',
    targetId: 'wiki-1',
    ownerUsername: 'alice',
    ownerModProfileName: null,
    channelUniqueName: 'cats'
  })
  const resolver = redactTextVersionRevision(
    buildResolverInput({
      TextVersion,
      driver,
      revisionType: 'comment'
    })
  )

  await assert.rejects(
    resolver(
      null,
      { textVersionId: 'version-1' },
      { user: { username: 'alice', data: { ModerationProfile: null } } } as unknown as GraphQLContext,
      {} as unknown as GraphQLResolveInfo
    ),
    /comment revision not found/
  )
})

test('assertCanRedactRevision rejects non-authors without mod permission', async () => {
  await assert.rejects(
    assertCanRedactRevision({
      context: {
        user: { username: 'bob', data: { ModerationProfile: { displayName: 'mod-bob' } } }
      } as unknown as GraphQLContext,
      target: {
        targetType: 'wiki',
        targetId: 'wiki-1',
        ownerUsername: 'alice',
        ownerModProfileName: null,
        channelUniqueName: 'cats'
      },
      revisionType: 'wiki',
      checkModPermissions: async () => new Error('No mod permission'),
      getServerMembership: async () => ({
        isServerAdmin: false,
        isServerModerator: false
      }),
      getUserData: async () => ({
        username: null,
        email: null,
        email_verified: false,
        data: null
      })
    }),
    /No mod permission/
  )
})
