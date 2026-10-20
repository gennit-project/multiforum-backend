import type { Driver } from "neo4j-driver";
import { createPipelineDetailRepository, type PipelineDetailRepository } from "../../services/persistence/pipelineDetailRepository.js";

const getResolver = ({ driver, pipelineDetailRepository = createPipelineDetailRepository(driver) }: {
  driver: Driver;
  pipelineDetailRepository?: PipelineDetailRepository;
}) => async (_parent: unknown, { pipelineRunId }: { pipelineRunId: string }) => {
  const attempts = await pipelineDetailRepository.findInternalAttempt(pipelineRunId);
  const attempt = attempts[0];
  if (!attempt) return null;
  const jobs = await pipelineDetailRepository.findInternalJobs(attempt.pipelineId);
  return { attempt, jobs };
};
export default getResolver;
