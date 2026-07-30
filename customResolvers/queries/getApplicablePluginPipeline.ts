import type {
  DownloadableFile as DownloadableFileType,
  DownloadableFileModel,
  ServerConfig as ServerConfigType,
  ServerConfigModel,
} from '../../ogm_types.js'
import type { EventPipeline, PluginEdgeData } from '../../services/plugin/types.js'
import { resolveDownloadPipelinePlan } from '../../services/plugin/downloadPipelinePlan.js'
import { assertPublicPipelineTargetVisible } from './pluginPipelineVisibility.js'

const getResolver = ({
  DownloadableFile,
  ServerConfig,
}: {
  DownloadableFile: DownloadableFileModel
  ServerConfig: ServerConfigModel
}) => async (
  _parent: unknown,
  {
    downloadableFileId,
    eventType = 'downloadableFile.created',
  }: { downloadableFileId: string; eventType?: string }
) => {
  await assertPublicPipelineTargetVisible({
    DownloadableFile,
    targetId: downloadableFileId,
    targetType: 'DownloadableFile',
  })
  const files = await DownloadableFile.find({
    where: { id: downloadableFileId },
    selectionSet: `{ id uploadedAt createdAt }`,
  })
  const file = files[0] as DownloadableFileType
  const configs = await ServerConfig.find({
    selectionSet: `{
      pluginPipelines
      InstalledVersionsConnection {
        edges {
          properties { enabled settingsJson }
          node {
            id version repoUrl tarballGsUri entryPath manifest
            settingsDefaults uiSchema
            Plugin {
              id name displayName description metadata
            }
          }
        }
      }
    }`,
  })
  const config = configs[0] as ServerConfigType | undefined
  const plan = resolveDownloadPipelinePlan({
    event: eventType,
    pipelines: (config?.pluginPipelines || []) as EventPipeline[],
    installedPluginEdges: (
      config?.InstalledVersionsConnection?.edges || []
    ) as unknown as PluginEdgeData[],
    uploadedAt: file.uploadedAt || file.createdAt,
  })

  return {
    targetId: downloadableFileId,
    targetType: 'DownloadableFile',
    eventType,
    applicability: plan.applicability,
    effectiveAt: plan.effectiveAt,
    required: plan.required,
    reason: plan.reason,
    expectedJobs: plan.pluginsToRun.map(
      ({ pluginId, edgeData, step, order }) => ({
        pluginId,
        pluginName:
          edgeData.node.Plugin.displayName ||
          edgeData.node.Plugin.name ||
          pluginId,
        version: edgeData.node.version,
        order,
        condition: step.condition || 'ALWAYS',
        continueOnError: step.continueOnError ?? false,
      })
    ),
  }
}

export default getResolver
