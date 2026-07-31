import { GraphQLError } from 'graphql'
import type {
  DiscussionModel,
  DownloadableFileModel,
} from '../../ogm_types.js'

export const assertPublicPipelineTargetVisible = async ({
  DownloadableFile,
  Discussion,
  targetId,
  targetType,
}: {
  DownloadableFile: DownloadableFileModel
  Discussion?: DiscussionModel
  targetId: string
  targetType: string
}) => {
  if (targetType === 'Discussion' && Discussion) {
    const discussions = await Discussion.find({
      where: { id: targetId },
      selectionSet: `{
        id
        deleted
        DownloadableFiles {
          id
          permanentlyRemoved
        }
        DiscussionChannels {
          archived
        }
      }`,
    })
    const discussion = discussions[0] as typeof discussions[number] & {
      DownloadableFiles?: Array<{ permanentlyRemoved?: boolean | null }>
      DiscussionChannels?: Array<{ archived?: boolean | null }>
    }
    const hasPublicChannel = discussion?.DiscussionChannels?.some(
      channel => channel.archived !== true
    )
    const hasPublicDownload = discussion?.DownloadableFiles?.some(
      file => file.permanentlyRemoved !== true
    )

    if (
      discussion &&
      discussion.deleted !== true &&
      hasPublicChannel &&
      hasPublicDownload
    ) {
      return discussion
    }
  } else if (targetType === 'DownloadableFile') {
    const files = await DownloadableFile.find({
      where: { id: targetId },
      selectionSet: `{
        id
        permanentlyRemoved
        Discussion {
          id
          deleted
          DiscussionChannels {
            channelUniqueName
            archived
          }
        }
      }`,
    })
    const file = files[0] as typeof files[number] & {
      Discussion?: {
        deleted?: boolean | null
        DiscussionChannels?: Array<{
          channelUniqueName?: string | null
          archived?: boolean | null
        }>
      } | null
    }
    const discussion = file?.Discussion
    const hasPublicChannel = discussion?.DiscussionChannels?.some(
      channel => channel.archived !== true
    )

    if (
      file &&
      file.permanentlyRemoved !== true &&
      discussion &&
      discussion.deleted !== true &&
      hasPublicChannel
    ) {
      return file
    }
  }

  throw new GraphQLError('Pipeline target not found', {
    extensions: { code: 'NOT_FOUND' },
  })
}
