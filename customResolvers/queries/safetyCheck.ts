import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";

const safetyCheck = async (
  parent: unknown,
  args: unknown,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  return {
    environment: {
      isTestEnvironment: process.env.NEO4J_URI?.includes('localhost'),
      currentDatabase: process.env.NEO4J_URI,
    },
  };
};
export default safetyCheck;
