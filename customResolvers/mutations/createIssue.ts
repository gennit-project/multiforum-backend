import type { IssueCreateInput, IssueModel } from "../../ogm_types.js";
import { GraphQLError } from "graphql";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";

type Args = {
  input: IssueCreateInput;
};

type Input = {
  Issue: IssueModel;
  driver: any;
};

const getResolver = (input: Input) => {
  const { Issue, driver } = input;
  return async (_parent: any, args: Args) => {
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
      const issueData = await Issue.create({
        input: [issueCreateInput],
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`,
      });
      const issue = issueData.issues?.[0];
      if (!issue?.id) {
        throw new GraphQLError("Error creating issue");
      }
      return issue;
    } catch (error: any) {
      console.error("Error creating issue with number", error);
      throw new GraphQLError("Error creating issue");
    }
  };
};

export default getResolver;
