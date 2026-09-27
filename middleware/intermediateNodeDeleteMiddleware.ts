import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import {
  quarantineConnectorsForDeletedParent,
  type DeletedParent,
} from "../services/intermediateNodeQuarantine.js";

type Resolver = (
  parent: unknown,
  args: { where?: { id?: string } },
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<{ nodesDeleted?: number }>;

const wrapDelete = (kind: DeletedParent["kind"]) =>
  async (
    resolve: Resolver,
    parent: unknown,
    args: { where?: { id?: string } },
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ): Promise<{ nodesDeleted?: number }> => {
    const id = args.where?.id;
    if (!id) {
      throw new Error(`Deleting an entire ${kind} set is not supported; provide where.id`);
    }
    const result = await resolve(parent, args, context, info);
    const nodesDeleted = typeof result.nodesDeleted === "number"
      ? result.nodesDeleted
      : (result.nodesDeleted as { toNumber?: () => number } | undefined)?.toNumber?.() ?? 0;
    if (nodesDeleted > 0) {
      await quarantineConnectorsForDeletedParent(context.driver, { kind, id });
    }
    return result;
  };

/** Preserve connector data while keeping parent deletes from creating active,
 * malformed DiscussionChannel/EventChannel nodes. */
const intermediateNodeDeleteMiddleware = {
  Mutation: {
    deleteDiscussions: wrapDelete("discussion"),
    deleteEvents: wrapDelete("event"),
  },
};

export default intermediateNodeDeleteMiddleware;
