import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { Event, EventWhere, EventUpdateInput } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";

type IsEventOwnerInput = {
  where: EventWhere;
  eventUpdateInput: EventUpdateInput;
  channelConnections: string[];
  channelDisconnections: string[];
};

export const isEventOwner = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsEventOwnerInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {

    let eventId;

    const { where } = args;
    if (where) {
      eventId = where.id;
    }

    // set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    let username = ctx.user.username;
    let ogm = ctx.ogm;

    if (!eventId) {
      throw new Error(ERROR_MESSAGES.event.noId);
    }
    const EventModel = ogm.model("Event");

    // Get the event owner by using the OGM on the
    // Event model.
    const events: Event[] = await EventModel.find({
      where: { id: eventId },
      selectionSet: `{
            Poster {
                username
            }
      }`,
    });

    if (!events || events.length === 0) {
      throw new Error(ERROR_MESSAGES.event.notFound);
    }
    const event = events[0];

    // Get the event author.
    const eventOwner = event?.Poster?.username;

    if (!eventOwner) {
      throw new Error(ERROR_MESSAGES.event.noOwner);
    }

    // Check if the user is in the list of channel owners.
    if (eventOwner !== username) {
      return false;  // Permission check - return false to allow OR to work
    }
    return true;
  }
);
