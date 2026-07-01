import assert from 'node:assert/strict'
import test from 'node:test'
import type { Driver } from 'neo4j-driver'
import type { GraphQLContext } from '../../types/context.js'
import trackDownload, {
  AUTO_SAVED_DOWNLOADS_COLLECTION_DESCRIPTION,
  AUTO_SAVED_DOWNLOADS_COLLECTION_NAME
} from './trackDownload.js'

type RunCall = [string, {
  username?: string
  downloadsCollectionName?: string
  downloadsCollectionDescription?: string
  downloadableFileId: string
  discussionId: string
}]

type FakeRecord = {
  get: (key: string) => number
}

const buildDriver = (updated = 1) => {
  const calls = {
    run: [] as RunCall[],
    close: 0,
    defaultAccessMode: null as string | null
  }

  const record: FakeRecord = {
    get: (key: string) => key === 'updated' ? updated : 0
  }

  const driver = {
    session: (input: { defaultAccessMode: string }) => {
      calls.defaultAccessMode = input.defaultAccessMode

      return {
        run: async (...args: RunCall) => {
          calls.run.push(args)
          return { records: [record] }
        },
        close: () => {
          calls.close += 1
        }
      }
    }
  }

  return { driver: driver as unknown as Driver, calls }
}

test('trackDownload requires a downloadable file ID', async () => {
  const { driver } = buildDriver()
  const resolver = trackDownload({ driver })

  await assert.rejects(
    resolver(null, { downloadableFileId: '', discussionId: 'discussion-1' }, {
      user: { username: 'alice' }
    } as unknown as GraphQLContext),
    /Downloadable file ID is required/
  )
})

test('trackDownload requires a discussion ID', async () => {
  const { driver } = buildDriver()
  const resolver = trackDownload({ driver })

  await assert.rejects(
    resolver(null, { downloadableFileId: 'file-1', discussionId: '' }, {
      user: { username: 'alice' }
    } as unknown as GraphQLContext),
    /Discussion ID is required/
  )
})

test('trackDownload counts anonymous downloads as total-only activity', async () => {
  const { driver, calls } = buildDriver()
  const resolver = trackDownload({
    driver,
    getUserData: async () => ({
      username: null,
      email: null,
      email_verified: false,
      data: null
    })
  })

  const result = await resolver(
    null,
    { downloadableFileId: 'file-1', discussionId: 'discussion-1' },
    {} as unknown as GraphQLContext
  )

  assert.equal(result, true)
  assert.equal(calls.run.length, 1)
  assert.equal(calls.run[0][1].username, undefined)
  assert.match(calls.run[0][0], /downloadCountTotal/)
  assert.doesNotMatch(calls.run[0][0], /downloadCountUnique/)
  assert.doesNotMatch(calls.run[0][0], /OWNS_DOWNLOAD/)
})

test('trackDownload updates counters and saves the download discussion', async () => {
  const { driver, calls } = buildDriver()
  const resolver = trackDownload({ driver })

  const result = await resolver(
    null,
    { downloadableFileId: 'file-1', discussionId: 'discussion-1' },
    { user: { username: 'alice' } } as unknown as GraphQLContext
  )

  assert.equal(result, true)
  assert.equal(calls.defaultAccessMode, 'WRITE')
  assert.equal(calls.close, 1)
  assert.equal(calls.run.length, 1)
  assert.equal(calls.run[0][1].username, 'alice')
  assert.equal(calls.run[0][1].downloadableFileId, 'file-1')
  assert.equal(calls.run[0][1].discussionId, 'discussion-1')
  assert.match(calls.run[0][0], /downloadCountTotal/)
  assert.match(calls.run[0][0], /downloadCountUnique/)
  assert.match(calls.run[0][0], /OWNS_DOWNLOAD/)
  assert.match(calls.run[0][0], /CREATED_BY/)
  assert.match(calls.run[0][0], /CONTAINS_DOWNLOAD/)
  assert.match(calls.run[0][0], /itemOrder/)
  assert.equal(
    calls.run[0][1].downloadsCollectionName,
    AUTO_SAVED_DOWNLOADS_COLLECTION_NAME
  )
  assert.equal(
    calls.run[0][1].downloadsCollectionDescription,
    AUTO_SAVED_DOWNLOADS_COLLECTION_DESCRIPTION
  )
})

test('trackDownload only appends to the downloads collection when the discussion is not already present', async () => {
  const { driver, calls } = buildDriver()
  const resolver = trackDownload({ driver })

  await resolver(
    null,
    { downloadableFileId: 'file-1', discussionId: 'discussion-1' },
    { user: { username: 'alice' } } as unknown as GraphQLContext
  )

  assert.match(calls.run[0][0], /existingCollectionDownload IS NULL/)
  assert.match(calls.run[0][0], /FOREACH/)
  assert.match(calls.run[0][0], /coalesce\(downloadsCollection.itemOrder, \[\]\) \+ \[\$discussionId\]/)
})

test('trackDownload treats a different authenticated user as a separate downloader', async () => {
  const { driver, calls } = buildDriver()
  const resolver = trackDownload({ driver })

  const result = await resolver(
    null,
    { downloadableFileId: 'file-1', discussionId: 'discussion-1' },
    { user: { username: 'bob' } } as unknown as GraphQLContext
  )

  assert.equal(result, true)
  assert.equal(calls.run[0][1].username, 'bob')
  assert.match(calls.run[0][0], /existingDownload IS NULL AS isUnique/)
  assert.match(
    calls.run[0][0],
    /downloadCountUnique = coalesce\(file.downloadCountUnique, 0\) \+ CASE WHEN isUnique THEN 1 ELSE 0 END/
  )
})

test('trackDownload throws when the file does not belong to the discussion', async () => {
  const { driver } = buildDriver(0)
  const resolver = trackDownload({ driver })

  await assert.rejects(
    resolver(null, { downloadableFileId: 'file-1', discussionId: 'discussion-1' }, {
      user: { username: 'alice' }
    } as unknown as GraphQLContext),
    /Downloadable file not found for this discussion/
  )
})
