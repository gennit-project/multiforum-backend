import type { Driver } from "neo4j-driver"
import { createPipelineTargetRepository, type PipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js"
import type {
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
  driver,
  pipelineTargetRepository = createPipelineTargetRepository(driver),
  PluginPipelineRun,
  PluginRun,
}: {
  driver: Driver
  pipelineTargetRepository?: PipelineTargetRepository
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
    repository: pipelineTargetRepository,
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
