import { rule } from "graphql-shield";
import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";

type CanEditEventsArgs = {
  where?: {
    id?: string;
    id_IN?: string[];
  };
  eventId?: string;
};

export const canEditEvents = rule({ cache: "contextual" })(
  async (parent: any, args: CanEditEventsArgs, context: any) => {
    const eventIds: string[] = [];

    if (args.eventId) {
      eventIds.push(args.eventId);
    }

    if (args.where?.id) {
      eventIds.push(args.where.id);
    }

    if (args.where?.id_IN?.length) {
      eventIds.push(...args.where.id_IN);
    }

    if (eventIds.length === 0) {
      return new Error("No event specified for this operation.");
    }

    const Event = context.ogm.model("Event");
    const events = await Event.find({
      where: { id_IN: eventIds },
      selectionSet: `{
        EventChannels { channelUniqueName }
      }`,
    });

    if (!events || events.length === 0) {
      return new Error("Could not find the event or its associated channel.");
    }

    const channelConnections = new Set<string>();

    for (const event of events) {
      const channels = event?.EventChannels || [];
      for (const channel of channels) {
        if (channel?.channelUniqueName) {
          channelConnections.add(channel.channelUniqueName);
        }
      }
    }

    if (channelConnections.size === 0) {
      return new Error("No channel specified for this operation.");
    }

    const permissionResult = await checkChannelModPermissions({
      channelConnections: Array.from(channelConnections),
      context,
      permissionCheck: ModChannelPermission.canEditEvents,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);
