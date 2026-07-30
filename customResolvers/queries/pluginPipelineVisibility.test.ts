import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPublicPipelineTargetVisible } from './pluginPipelineVisibility.js'

const model = (rows: unknown[]) => ({
  find: async () => rows,
})

test('allows a download attached to a visible discussion channel', async () => {
  const result = await assertPublicPipelineTargetVisible({
    DownloadableFile: model([
      {
        id: 'file-1',
        permanentlyRemoved: false,
        Discussion: {
          deleted: false,
          DiscussionChannels: [{ archived: false }],
        },
      },
    ]) as any,
    targetId: 'file-1',
    targetType: 'DownloadableFile',
  })

  assert.equal(result.id, 'file-1')
})

test('hides removed, deleted, archived, missing, and unsupported targets', async () => {
  const hiddenRows = [
    [{ id: 'file-1', permanentlyRemoved: true }],
    [{ id: 'file-1', Discussion: { deleted: true } }],
    [
      {
        id: 'file-1',
        Discussion: {
          deleted: false,
          DiscussionChannels: [{ archived: true }],
        },
      },
    ],
    [],
  ]

  const outcomes = await Promise.all(
    hiddenRows.map(rows =>
      assertPublicPipelineTargetVisible({
        DownloadableFile: model(rows) as any,
        targetId: 'file-1',
        targetType: 'DownloadableFile',
      }).then(
        () => 'visible',
        error => error.extensions?.code
      )
    )
  )
  outcomes.push(
    await assertPublicPipelineTargetVisible({
      DownloadableFile: model([]) as any,
      targetId: 'discussion-1',
      targetType: 'Discussion',
    }).then(
      () => 'visible',
      error => error.extensions?.code
    )
  )

  assert.deepEqual(outcomes, [
    'NOT_FOUND',
    'NOT_FOUND',
    'NOT_FOUND',
    'NOT_FOUND',
    'NOT_FOUND',
  ])
})
