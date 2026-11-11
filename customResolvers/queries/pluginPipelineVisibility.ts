import { GraphQLError } from 'graphql'
import type { PipelineTargetRepository, PipelineDiscussionSnapshot, PipelineDownloadSnapshot } from "../../services/persistence/pipelineTargetRepository.js"

type VisibilityInput = {
  repository: PipelineTargetRepository
  targetId: string
  targetType: string
}
export function assertPublicPipelineTargetVisible(input: VisibilityInput & { targetType: 'Discussion' }): Promise<PipelineDiscussionSnapshot>
export function assertPublicPipelineTargetVisible(input: VisibilityInput & { targetType: 'DownloadableFile' }): Promise<PipelineDownloadSnapshot>
export function assertPublicPipelineTargetVisible(input: VisibilityInput): Promise<PipelineDiscussionSnapshot | PipelineDownloadSnapshot>
export async function assertPublicPipelineTargetVisible({ repository, targetId, targetType }: VisibilityInput) {
  if (targetType === 'Discussion') {
    const discussions = await repository.findDiscussionVisibility(targetId)
    const discussion = discussions[0]
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
    const file = files[0]
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
