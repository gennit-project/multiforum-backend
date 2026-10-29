import {getGeneratedSchema} from "../services/persistence/generatedSchemaOperations.js";
import {eventMutationWriteInfo, projectEventMutation} from "../services/persistence/eventMutationProjection.js";
import { createEventRevisionRepository } from "../services/persistence/eventRevisionRepository.js";
import { executeManagedWrite } from "../services/neo4jTransactions.js";
import { eventEditNotificationHandler, eventRevisionActivityHandler } from "../hooks/eventVersionHistoryHook.js";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import type { EventWhere, EventUpdateInput } from "../src/generated/graphql.js";

type UpdateEventsArgs = { where?: EventWhere; update?: EventUpdateInput };

const eventVersionHistoryMiddleware = {
  Mutation: {
    updateEvents: async (
      resolve: (parent: unknown, args: UpdateEventsArgs, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<unknown>,
      parent: unknown, args: UpdateEventsArgs, context: GraphQLContext, info: GraphQLResolveInfo
    ) => {
      const id = args.where?.id?.eq;
      const update = args.update;
      if (!id || !update || (update.title === undefined && update.description === undefined)) {
        return resolve(parent, args, context, info);
      }
      // Shield remains outside this middleware. The generated resolver keeps
      // its full filter/input semantics and public response projection.
      const repository = context.eventRevisionRepository ?? createEventRevisionRepository(context.driver);
      const committed = await executeManagedWrite(context.driver, async tx => {
        const snapshot = await repository.lockSnapshot(id, tx);
        const result = await resolve(parent, args, {...context, executionContext: tx} as GraphQLContext, eventMutationWriteInfo(info));
        const revisions = snapshot ? await repository.recordChanges(snapshot, context.user?.username || null, tx) : [];
        // Project under the same lock so each concurrent caller receives its
        // own edit. GraphQL completion errors are surfaced only after commit;
        // they are not failures of the already-successful business write.
        let projected: unknown;
        let projectionError: unknown;
        try {
          projected = await projectEventMutation(getGeneratedSchema(context.driver), result as Record<string, unknown>, {...context, executionContext: tx}, info);
        } catch (error) {
          projectionError = error;
        }
        return {result: projected, snapshot, revisions, projectionError};
      });
      await eventRevisionActivityHandler(context, id, committed.revisions);
      if (committed.snapshot && committed.revisions.length) {
        await eventEditNotificationHandler({context, eventSnapshot: committed.snapshot,
          params: {where: {id}, update: {title: update.title?.set, description: update.description?.set}}});
      }
      if (committed.projectionError) throw committed.projectionError;
      return committed.result;
    },
  },
};
export default eventVersionHistoryMiddleware;
