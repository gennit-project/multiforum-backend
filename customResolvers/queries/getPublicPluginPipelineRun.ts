import type { Driver } from "neo4j-driver"
import { createPipelineTargetRepository, type PipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js"
import { createPipelineDetailRepository, type PipelineDetailRepository } from "../../services/persistence/pipelineDetailRepository.js"
import {
  toPublicPipelineRun,
} from '../../services/plugin/publicPipeline.js'
import { assertPublicPipelineTargetVisible } from './pluginPipelineVisibility.js'

const getResolver = ({
  driver,
  pipelineTargetRepository = createPipelineTargetRepository(driver),
  pipelineDetailRepository = createPipelineDetailRepository(driver),
}: {
  driver: Driver
  pipelineTargetRepository?: PipelineTargetRepository
  pipelineDetailRepository?: PipelineDetailRepository
}) => async (_parent: unknown, { pipelineRunId }: { pipelineRunId: string }) => {
  const attempts = await pipelineDetailRepository.findPublicAttempt(pipelineRunId)
  const attempt = attempts[0]
  if (!attempt) return null

  await assertPublicPipelineTargetVisible({
    repository: pipelineTargetRepository,
    targetId: attempt.targetId,
    targetType: attempt.targetType,
  })
  const jobs = await pipelineDetailRepository.findPublicJobs(attempt.pipelineId)

  return toPublicPipelineRun({
    attempt,
    jobs,
  })
}

export default getResolver
