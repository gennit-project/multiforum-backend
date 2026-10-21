import type { Driver } from "neo4j-driver"
import { createPipelineTargetRepository, type PipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js"
import { createPipelineHistoryRepository, type PipelineHistoryRepository } from "../../services/persistence/pipelineHistoryRepository.js"
import {
  toPublicPipelineRun,
} from '../../services/plugin/publicPipeline.js'
import { assertPublicPipelineTargetVisible } from './pluginPipelineVisibility.js'

const getResolver = ({
  driver,
  pipelineTargetRepository = createPipelineTargetRepository(driver),
  pipelineHistoryRepository = createPipelineHistoryRepository(driver),
}: {
  driver: Driver
  pipelineTargetRepository?: PipelineTargetRepository
  pipelineHistoryRepository?: PipelineHistoryRepository
}) => async (
  _parent: unknown,
  { targetId, targetType }: { targetId: string; targetType: string }
) => {
  await assertPublicPipelineTargetVisible({
    repository: pipelineTargetRepository,
    targetId,
    targetType,
  })
  const attempts = await pipelineHistoryRepository.findSummaryAttempts(targetId, targetType)
  const jobs = await pipelineHistoryRepository.findSummaryJobs(targetId, targetType)

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
