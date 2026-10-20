import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { createPipelineHistoryRepository, type PipelineHistoryRepository } from "../../services/persistence/pipelineHistoryRepository.js";

const getResolver = ({ driver, pipelineHistoryRepository = createPipelineHistoryRepository(driver) }: {
  driver: Driver;
  pipelineHistoryRepository?: PipelineHistoryRepository;
}) => async (_parent: unknown, args: { downloadableFileId: string }, _context: GraphQLContext, _info: GraphQLResolveInfo) => {
  return pipelineHistoryRepository.findDownloadHistory(args.downloadableFileId);
};
export default getResolver;
