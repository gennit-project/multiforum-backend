import type {
  DiscussionModel,
  DownloadableFileModel,
  PluginPipelineRunModel,
  PluginRunModel,
} from '../../ogm_types.js'
import { SortDirection } from '../../ogm_types.js'
import {
  PUBLIC_PIPELINE_ATTEMPT_SELECTION,
  PUBLIC_PLUGIN_JOB_SELECTION,
  toPublicPipelineRun,
} from '../../services/plugin/publicPipeline.js'
import { assertPublicPipelineTargetVisible } from './pluginPipelineVisibility.js'

const getResolver = ({
  Discussion,
  DownloadableFile,
  PluginPipelineRun,
  PluginRun,
}: {
  Discussion: DiscussionModel
  DownloadableFile: DownloadableFileModel
  PluginPipelineRun: PluginPipelineRunModel
  PluginRun: PluginRunModel
}) => async (_parent: unknown, { pipelineRunId }: { pipelineRunId: string }) => {
  const attempts = await PluginPipelineRun.find({
    where: { id: pipelineRunId },
    selectionSet: PUBLIC_PIPELINE_ATTEMPT_SELECTION,
  })
  const attempt = attempts[0]
  if (!attempt) return null

  await assertPublicPipelineTargetVisible({
    Discussion,
    DownloadableFile,
    targetId: attempt.targetId,
    targetType: attempt.targetType,
  })
  const jobs = await PluginRun.find({
    where: { pipelineId: attempt.pipelineId },
    options: { sort: [{ executionOrder: SortDirection.Asc }] },
    selectionSet: PUBLIC_PLUGIN_JOB_SELECTION,
  })

  return toPublicPipelineRun({
    attempt,
    jobs,
  })
}

export default getResolver
