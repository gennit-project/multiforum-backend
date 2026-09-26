import type { GraphQLResolveInfo, GraphQLSchema } from "graphql";
import { middleware } from "graphql-middleware";
import type { IMiddlewareTypeMap } from "graphql-middleware";
import type { GraphQLContext } from "../types/context.js";
import { mayAccessSensitiveContent } from "../services/sensitiveContentAccess.js";
import { invalidateAgePolicyCache } from "../services/agePolicyCache.js";

type Resolver = (
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

export const applySensitiveContentPolicy = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  const access = await mayAccessSensitiveContent({
    context,
    driver: context.driver,
    ServerConfig: context.ogm.model("ServerConfig"),
  });

  // @neo4j/graphql consumes context.jwt while translating authorization
  // directives. Merge only the server-computed claim after authentication and
  // birthday lookup; request input and token claims never set this value.
  context.jwt = {
    ...context.jwt,
    mayAccessSensitiveContent: access,
  };

  const result = await resolve(parent, args, context, info);

  // The age policy lives on ServerConfig and is cached for the per-request
  // check above; drop it as soon as this process writes a ServerConfig so a
  // changed policy applies to the next request.
  if (
    info?.parentType?.name === "Mutation" &&
    /ServerConfigs?$/.test(info.fieldName)
  ) {
    invalidateAgePolicyCache();
  }

  return result;
};

export const buildSensitiveContentPolicyMiddleware = (schema: GraphQLSchema) => {
  const policy: IMiddlewareTypeMap<unknown, GraphQLContext, Record<string, unknown>> = {};
  if (schema.getQueryType()) policy.Query = applySensitiveContentPolicy;
  if (schema.getMutationType()) policy.Mutation = applySensitiveContentPolicy;
  if (schema.getSubscriptionType()) policy.Subscription = applySensitiveContentPolicy;
  return policy;
};

const sensitiveContentPolicyMiddleware = middleware(
  buildSensitiveContentPolicyMiddleware
);

export default sensitiveContentPolicyMiddleware;
