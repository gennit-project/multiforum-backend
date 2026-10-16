import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import type { EventWhere, EventUpdateInput } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { passesAsServerAdminOrRoot } from "../serverAdminOverride.js";
import { createContentAuthorizationRepository } from "../../../services/persistence/contentAuthorizationRepository.js";

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
    // Server admins and the env root pass any ownership-gated mutation (replaces isAdmin).
    if (await passesAsServerAdminOrRoot(ctx)) {
      return true;
    }

    ctx.user = await setUserDataOnContext({
      context: ctx,
    });

    let username = ctx.user.username;
    if (!eventId) {
      throw new Error(ERROR_MESSAGES.event.noId);
    }
    const repository =
      ctx.contentAuthorizationRepository ??
      createContentAuthorizationRepository(ctx.driver);
    const event = await repository.findEventPoster(eventId);

    if (!event.found) {
      throw new Error(ERROR_MESSAGES.event.notFound);
    }
    const eventOwner = event.username;

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
