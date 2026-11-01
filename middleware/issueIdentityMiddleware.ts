import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import {
  assertIssueIdentityUpdateAllowed,
  attachIssueIdentityRelationships,
} from "../services/issueTargetIdentity.js";

type Resolver = (
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

const sanitizeCreateInputs = (input: unknown) => {
  const inputs = Array.isArray(input) ? input : input ? [input] : [];
  return inputs.map((entry) => attachIssueIdentityRelationships(entry));
};

export const createIssuesWithTargetIdentity = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => resolve(
  parent,
  { ...args, input: sanitizeCreateInputs(args.input) },
  context,
  info
);

export const createIssueWithTargetIdentity = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  // The application resolver assigns authenticated identity and number atomically.
  return resolve(parent, args, context, info);
};

export const protectIssueIdentityUpdate = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  assertIssueIdentityUpdateAllowed(args.update);
  return resolve(parent, args, context, info);
};

export default {
  Mutation: {
    createIssue: createIssueWithTargetIdentity,
    createIssues: createIssuesWithTargetIdentity,
    updateIssues: protectIssueIdentityUpdate,
  },
};
