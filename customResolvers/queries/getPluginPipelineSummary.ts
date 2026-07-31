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
}) => async (
  _parent: unknown,
  { targetId, targetType }: { targetId: string; targetType: string }
) => {
  await assertPublicPipelineTargetVisible({
    Discussion,
    DownloadableFile,
    targetId,
    targetType,
  })
  const attempts = await PluginPipelineRun.find({
    where: { targetId, targetType },
    options: { sort: [{ createdAt: SortDirection.Desc }] },
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
        attempt,
        jobs,
      })
    ),
  }
}

export default getResolver
