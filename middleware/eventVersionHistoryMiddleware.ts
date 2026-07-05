/**
 * Middleware for tracking event version history.
 * This middleware runs before event update operations to capture the previous
 * values of title and description before they are updated. It mirrors the
 * discussion version history middleware.
 */

import {
  eventEditNotificationHandler,
  eventVersionHistoryHandler,
  type EventSnapshot,
} from "../hooks/eventVersionHistoryHook.js";
import { GraphQLResolveInfo } from 'graphql';
import type { GraphQLContext } from "../types/context.js";

interface UpdateEventsArgs {
  where?: {
    id?: string;
  };
  update?: {
    title?: string;
    description?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const eventSnapshotSelectionSet = `{
  id
  title
  description
  Poster {
    username
  }
  DescriptionLastEditedBy {
    username
  }
  EventChannels {
    channelUniqueName
  }
  PastTitleVersions {
    id
    body
    createdAt
  }
  PastDescriptionVersions {
    id
    body
    createdAt
  }
}`;

const eventVersionHistoryMiddleware = {
  Mutation: {
    // Apply to the auto-generated updateEvents mutation
    updateEvents: async (
      resolve: (parent: unknown, args: UpdateEventsArgs, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<unknown>,
      parent: unknown,
      args: UpdateEventsArgs,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const { where, update } = args;
      if (!update) {
        return resolve(parent, args, context, info);
      }
      const eventId = where?.id;
      let eventSnapshot: EventSnapshot | null = null;

      if (update.title !== undefined || update.description !== undefined) {
        if (eventId) {
          const EventModel = context.ogm.model("Event");
          const events = await EventModel.find({
            where: { id: eventId },
            selectionSet: eventSnapshotSelectionSet,
          });
          eventSnapshot = (events[0] as unknown as EventSnapshot) ?? null;
        }

        if (eventSnapshot) {
          await eventVersionHistoryHandler({
            context,
            params: { where, update },
            eventSnapshot,
          });
        }
      }

      const result = await resolve(parent, args, context, info);

      if (eventSnapshot && eventId) {
        await eventEditNotificationHandler({
          context,
          params: { where, update },
          eventSnapshot,
        });
      }

      return result;
    },
  },
};

export default eventVersionHistoryMiddleware;
