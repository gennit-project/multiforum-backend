import assert from 'node:assert/strict'
import test from 'node:test'
import updateDownloadableFileSupportSettings, {
  validateSupportSettings
} from './updateDownloadableFileSupportSettings.js'

const buildDriver = ({
  target = {
    authorUsername: 'alice',
    channelUniqueNames: ['cats']
  },
  updated = 1
}: {
  target?: { authorUsername: string | null; channelUniqueNames: string[] } | null
  updated?: number
} = {}) => {
  const calls = {
    sessions: [] as string[],
    run: [] as any[],
    close: 0
  }

  const driver = {
    session: ({ defaultAccessMode }: { defaultAccessMode: string }) => {
      calls.sessions.push(defaultAccessMode)

      return {
        run: async (...args: any[]) => {
          calls.run.push(args)

          if (defaultAccessMode === 'READ') {
            return {
              records: target
                ? [
                    {
                      get: (key: string) =>
                        key === 'authorUsername'
                          ? target.authorUsername
                          : target.channelUniqueNames
                    }
                  ]
                : []
            }
          }

          return {
            records: [
              {
                get: () => updated
              }
            ]
          }
        },
        close: () => {
          calls.close += 1
        }
      }
    }
  }

  return { driver, calls }
}

test('validateSupportSettings accepts supported domains', () => {
  assert.doesNotThrow(() =>
    validateSupportSettings({
      supportPatreonUrl: 'https://patreon.com/alice',
      supportBuyMeACoffeeUrl: 'https://buymeacoffee.com/alice',
      supportKoFiUrl: 'https://ko-fi.com/alice',
      supportPayPalMeUrl: 'https://paypal.me/alice'
    })
  )
})

test('validateSupportSettings rejects an unexpected support URL host', () => {
  assert.throws(
    () =>
      validateSupportSettings({
        supportPatreonUrl: 'https://example.com/alice'
      }),
    /Patreon URL must use the expected support site/
  )
})

test('updateDownloadableFileSupportSettings lets the download author update support settings', async () => {
  const { driver, calls } = buildDriver()
  const resolver = updateDownloadableFileSupportSettings({ driver })

  const result = await resolver(
    null,
    {
      downloadableFileId: 'file-1',
      discussionId: 'discussion-1',
      input: {
        attributionOverride: 'Custom attribution',
        supportPatreonUrl: 'https://patreon.com/alice'
      }
    },
    { user: { username: 'alice' } }
  )

  assert.equal(result, true)
  assert.deepEqual(calls.sessions, ['READ', 'WRITE'])
  assert.equal(calls.close, 2)
  assert.equal(calls.run[1][1].attributionOverride, 'Custom attribution')
  assert.equal(calls.run[1][1].supportPatreonUrl, 'https://patreon.com/alice')
})

test('updateDownloadableFileSupportSettings lets a moderator with discussion edit permission update support settings', async () => {
  const { driver, calls } = buildDriver({
    target: {
      authorUsername: 'alice',
      channelUniqueNames: ['cats']
    }
  })
  const permissionCalls: any[] = []
  const resolver = updateDownloadableFileSupportSettings({
    driver,
    checkModPermissions: async (input: any) => {
      permissionCalls.push(input)
      return true
    },
    getServerMembership: async () => ({
      isServerAdmin: false,
      isServerModerator: false
    })
  })

  await resolver(
    null,
    {
      downloadableFileId: 'file-1',
      discussionId: 'discussion-1',
      input: {}
    },
    { user: { username: 'mod' } }
  )

  assert.equal(calls.run.length, 2)
  assert.deepEqual(permissionCalls[0].channelConnections, ['cats'])
  assert.equal(permissionCalls[0].permissionCheck, 'canEditDiscussions')
})

test('updateDownloadableFileSupportSettings rejects an unrelated user', async () => {
  const { driver } = buildDriver()
  const resolver = updateDownloadableFileSupportSettings({
    driver,
    checkModPermissions: async () => false,
    getServerMembership: async () => ({
      isServerAdmin: false,
      isServerModerator: false
    })
  })

  await assert.rejects(
    resolver(
      null,
      {
        downloadableFileId: 'file-1',
        discussionId: 'discussion-1',
        input: {}
      },
      { user: { username: 'bob' } }
    ),
    /You do not have permission to update this download/
  )
})
