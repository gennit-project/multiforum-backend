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
}) => async (
  _parent: unknown,
  { targetId, targetType }: { targetId: string; targetType: string }
) => {
  await assertPublicPipelineTargetVisible({
    DownloadableFile,
    targetId,
    targetType,
  })
  const attempts = await PluginPipelineRun.find({
    where: { targetId, targetType },
    options: { sort: [{ createdAt: 'DESC' }] } as any,
    selectionSet: PUBLIC_PIPELINE_ATTEMPT_SELECTION,
  })
  const jobs = await PluginRun.find({
    where: { targetId, targetType },
    selectionSet: PUBLIC_PLUGIN_JOB_SELECTION,
  })

  return {
    targetId,
    targetType,
    attempts: attempts.map(attempt =>
      toPublicPipelineRun({
        attempt: attempt as any,
        jobs: jobs as any,
      })
    ),
  }
}

export default getResolver
