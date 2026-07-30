import { GraphQLError } from 'graphql'
import type { DownloadableFileModel } from '../../ogm_types.js'

export const assertPublicPipelineTargetVisible = async ({
  DownloadableFile,
  targetId,
  targetType,
}: {
  DownloadableFile: DownloadableFileModel
  targetId: string
  targetType: string
}) => {
  if (targetType !== 'DownloadableFile') {
    throw new GraphQLError('Pipeline target not found', {
      extensions: { code: 'NOT_FOUND' },
    })
  }

  const files = await DownloadableFile.find({
    where: { id: targetId },
    selectionSet: `{
      id
      permanentlyRemoved
      Discussion {
        id
        deleted
        DiscussionChannels {
          archived
        }
      }
    }`,
  })
  const file = files[0] as typeof files[number] & {
    Discussion?: {
      deleted?: boolean | null
      DiscussionChannels?: Array<{ archived?: boolean | null }>
    } | null
  }
  const discussion = file?.Discussion
  const hasPublicChannel = discussion?.DiscussionChannels?.some(
    channel => channel.archived !== true
  )

  if (
    !file ||
    file.permanentlyRemoved === true ||
    !discussion ||
    discussion.deleted === true ||
    !hasPublicChannel
  ) {
    throw new GraphQLError('Pipeline target not found', {
      extensions: { code: 'NOT_FOUND' },
    })
  }

  return file
}
