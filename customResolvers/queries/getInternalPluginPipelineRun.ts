import {internalAttemptSource,internalJobSource} from '../contracts/internalPipelineSources.js';
import {rememberCanonicalSource} from '../../services/canonicalSourceFields.js';
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
  return rememberCanonicalSource({ attempt:internalAttemptSource(attempt), jobs:jobs.map(internalJobSource) });
};
export default getResolver;
