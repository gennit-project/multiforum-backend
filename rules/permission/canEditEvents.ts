import { idsFromScalarFilter, type IdFilter } from "../../utils/scalarFilter.js";
import { rule } from "graphql-shield";
import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import type { GraphQLContext } from "../../types/context.js";
import { createContentChannelPermissionRepository } from "../../services/persistence/contentChannelPermissionRepository.js";

type CanEditEventsArgs = {
  where?: {
    id?: IdFilter;
    id_IN?: string[] | null;
  } | null;
  eventId?: string;
};

export const canEditEventsHandler = async (
  _parent: unknown,
  args: CanEditEventsArgs,
  context: GraphQLContext
) => {
    const eventIds: string[] = [];

    if (args.eventId) {
      eventIds.push(args.eventId);
    }

    eventIds.push(...idsFromScalarFilter(args.where?.id));

    if (args.where?.id_IN?.length) {
      eventIds.push(...args.where.id_IN);
    }

    if (eventIds.length === 0) {
      return new Error("No event specified for this operation.");
    }

    const repository =
      context.contentChannelPermissionRepository ??
      createContentChannelPermissionRepository(context.driver);
    const lookup = await repository.findEventChannels(eventIds);

    if (!lookup.found) {
      return new Error("Could not find the event or its associated channel.");
    }

    const channelConnections = lookup.channelUniqueNames;

    if (channelConnections.length === 0) {
      return new Error("No channel specified for this operation.");
    }

    const permissionResult = await checkChannelModPermissions({
      channelConnections,
      context,
      permissionCheck: ModChannelPermission.canEditEvents,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
};

export const canEditEvents = rule({ cache: "strict" })(
  canEditEventsHandler
);
