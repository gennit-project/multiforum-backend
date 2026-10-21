import type { IssueCreateInput } from "../../ogm_types.js";
import type { Driver } from "neo4j-driver";
import { GraphQLError } from "graphql";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";
import { attachIssueIdentityRelationships } from "../../services/issueTargetIdentity.js";
import { createIssueCreationRepository, type IssueCreationRepository } from "../../services/persistence/issueCreationRepository.js";
import { logger } from "../../logger.js";

type Args = {
  input: IssueCreateInput;
};

type Input = {
  issueCreationRepository?: IssueCreationRepository;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.issueCreationRepository ?? createIssueCreationRepository(driver);
  return async (_parent: unknown, args: Args) => {
    const { input: issueInput } = args;
    const channelUniqueName = issueInput.channelUniqueName;

    if (!channelUniqueName) {
      throw new GraphQLError("channelUniqueName is required");
    }

    const issueNumber = await getNextIssueNumber(driver, channelUniqueName);
    const issueCreateInput = {
      ...issueInput,
      issueNumber,
    } as IssueCreateInput & { issueNumber: number };

    try {
      const issue = await repository.create(attachIssueIdentityRelationships(issueCreateInput));
      if (!issue?.id) {
        throw new GraphQLError("Error creating issue");
      }
      return issue;
    } catch (error: unknown) {
      logger.error("Error creating issue with number", error);
      throw new GraphQLError("Error creating issue");
    }
  };
};

export default getResolver;
