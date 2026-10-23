import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import { setUserDataOnContext } from "../rules/permission/userDataHelperFunctions.js";
import {
  sanitizeAlbumCreateInput,
  sanitizeCollectionCreateInput,
} from "../customResolvers/mutations/utils/ownershipSanitizers.js";
import { resolveRequestIdentityRepository } from "../services/persistence/requestIdentityRepository.js";

/**
 * Forces the owner of albums and collections created through the public API
 * to be the signed-in user, whatever the client sent.
 *
 * This is middleware rather than a custom resolver on purpose. Server-side
 * writes run the generated mutations over the base schema (see
 * services/persistence/generatedSchemaOperations.ts), whereas `applyMiddleware`
 * wraps only the schema served over HTTP. A custom resolver replacing the
 * generated `createX` mutation would also change what a server-side `createX`
 * runs, so a replacement that then calls `createX` would recurse without the
 * HTTP request, find no signed-in user and fail. Middleware avoids that.
 */

type Resolver = (
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

type OwnershipMessages = {
  loggedOut: string;
  unknownUser: string;
};

const requireExistingUsername = async (
  context: GraphQLContext,
  messages: OwnershipMessages
): Promise<string> => {
  context.user = await setUserDataOnContext({ context });
  const username = context.user?.username;
  if (!username) {
    throw new GraphQLError(messages.loggedOut);
  }

  const repository = resolveRequestIdentityRepository(context);
  if (!(await repository.userExists(username))) {
    throw new GraphQLError(messages.unknownUser);
  }
  return username;
};

type ForceOwnerParams = {
  messages: OwnershipMessages;
  sanitize: (input: unknown, username: string) => unknown;
};

const forceOwner =
  ({ messages, sanitize }: ForceOwnerParams) =>
  async (
    resolve: Resolver,
    parent: unknown,
    args: Record<string, unknown>,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const username = await requireExistingUsername(context, messages);
    const inputs = Array.isArray(args.input) ? args.input : [];
    return resolve(
      parent,
      { ...args, input: inputs.map((input) => sanitize(input, username)) },
      context,
      info
    );
  };

export const forceAlbumOwner = forceOwner({
  messages: {
    loggedOut: "You must be logged in to create albums.",
    unknownUser: "Could not find the album owner.",
  },
  sanitize: sanitizeAlbumCreateInput,
});

export const forceCollectionOwner = forceOwner({
  messages: {
    loggedOut: "You must be logged in to create collections.",
    unknownUser: "Could not find the collection owner.",
  },
  sanitize: sanitizeCollectionCreateInput,
});

const ownershipCreateMiddleware = {
  Mutation: {
    createAlbums: forceAlbumOwner,
    createCollections: forceCollectionOwner,
  },
};

export default ownershipCreateMiddleware;
