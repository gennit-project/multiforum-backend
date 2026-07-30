import type {
  DownloadableFileModel,
  PluginPipelineRunModel,
  PluginRunModel,
} from '../../ogm_types.js'
import {
  PUBLIC_PIPELINE_ATTEMPT_SELECTION,
  PUBLIC_PLUGIN_JOB_SELECTION,
  toPublicPipelineRun,
} from '../../services/plugin/publicPipeline.js'
import { assertPublicPipelineTargetVisible } from './pluginPipelineVisibility.js'

const getResolver = ({
  DownloadableFile,
  PluginPipelineRun,
  PluginRun,
}: {
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
    DownloadableFile,
    targetId: attempt.targetId,
    targetType: attempt.targetType,
  })
  const jobs = await PluginRun.find({
    where: { pipelineId: attempt.pipelineId },
    options: { sort: [{ executionOrder: 'ASC' }] } as any,
    selectionSet: PUBLIC_PLUGIN_JOB_SELECTION,
  })

  return toPublicPipelineRun({
    attempt: attempt as any,
    jobs: jobs as any,
  })
}

export default getResolver
