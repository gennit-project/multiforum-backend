import { GraphQLError } from 'graphql'
import type { PipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js"

export const assertPublicPipelineTargetVisible = async ({
  repository,
  targetId,
  targetType,
}: {
  repository: PipelineTargetRepository
  targetId: string
  targetType: string
}) => {
  if (targetType === 'Discussion') {
    const discussions = await repository.findDiscussionVisibility(targetId)
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
    const files = await repository.findDownloadVisibility(targetId)
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
