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
 *
 * FAMILY-3 / v7 (campaign #284): v7 removed the nested to-one connect, so the
 * generated createAlbums/createCollections can no longer attach an existing
 * Owner/CreatedBy (or per-image Uploader). The owner identity is still forced
 * here, but applied as an owned post-create write (MERGE the edges by the ids
 * the generated create returned) instead of via the create input. The to-one
 * connects are stripped from the input before it reaches the generated mutation.
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

// Remove the to-one owner/uploader connects v7 can no longer accept on a create
// input, leaving the scalars (and to-many nested Images.create, whose HAS_IMAGE
// edges the generated create still makes) intact.
const stripOwnershipConnects = (input: unknown): unknown => {
  if (!input || typeof input !== "object") return input;
  const { Owner, CreatedBy, Images, ...rest } = input as Record<string, any>;
  void Owner;
  void CreatedBy;
  const out: Record<string, unknown> = { ...rest };
  if (Images && Images.create) {
    const entries = Array.isArray(Images.create) ? Images.create : [Images.create];
    out.Images = {
      ...Images,
      create: entries.map((entry: any) => {
        if (!entry || !entry.node) return entry;
        const { Uploader, ...restNode } = entry.node as Record<string, unknown>;
        void Uploader;
        return { ...entry, node: restNode };
      }),
    };
  }
  return out;
};

const createdIds = (result: unknown, resultKey: string): string[] =>
  (((result as Record<string, any>)?.[resultKey] as Array<{ id?: unknown }> | undefined) ?? [])
    .map((node) => node?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

// Owned post-create ownership writes. Album: MERGE the owner (HAS_ALBUM) and set
// every album image's Uploader (UPLOADED_IMAGE) to the owner. Collection: MERGE
// the creator (CREATED_BY).
const ALBUM_OWNER_CYPHER = `
 UNWIND $ids AS albumId
 MATCH (a:Album {id: albumId})
 OPTIONAL MATCH (u:User {username: $username})
 FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | MERGE (u)-[:HAS_ALBUM]->(a))
 WITH a, u
 OPTIONAL MATCH (a)-[:HAS_IMAGE]->(img:Image)
 FOREACH (_ IN CASE WHEN (u IS NULL OR img IS NULL) THEN [] ELSE [1] END |
  MERGE (u)-[:UPLOADED_IMAGE]->(img)
 )
`;
const COLLECTION_OWNER_CYPHER = `
 UNWIND $ids AS collectionId
 MATCH (c:Collection {id: collectionId})
 OPTIONAL MATCH (u:User {username: $username})
 FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | MERGE (c)-[:CREATED_BY]->(u))
`;

type ForceOwnerParams = {
  messages: OwnershipMessages;
  sanitize: (input: unknown, username: string) => unknown;
  resultKey: string;
  ownerCypher: string;
};

const forceOwner =
  ({ messages, sanitize, resultKey, ownerCypher }: ForceOwnerParams) =>
  async (
    resolve: Resolver,
    parent: unknown,
    args: Record<string, unknown>,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const username = await requireExistingUsername(context, messages);
    const inputs = Array.isArray(args.input) ? args.input : [];
    // sanitize still fills non-ownership defaults (e.g. collection visibility);
    // the owner connects it stamps are then stripped before the generated create.
    const cleanInputs = inputs.map((input) =>
      stripOwnershipConnects(sanitize(input, username))
    );
    const result = await resolve(parent, { ...args, input: cleanInputs }, context, info);

    const ids = createdIds(result, resultKey);
    if (ids.length > 0) {
      await context.driver.executeQuery(ownerCypher, { ids, username });
    }
    return result;
  };

export const forceAlbumOwner = forceOwner({
  messages: {
    loggedOut: "You must be logged in to create albums.",
    unknownUser: "Could not find the album owner.",
  },
  sanitize: sanitizeAlbumCreateInput,
  resultKey: "albums",
  ownerCypher: ALBUM_OWNER_CYPHER,
});

export const forceCollectionOwner = forceOwner({
  messages: {
    loggedOut: "You must be logged in to create collections.",
    unknownUser: "Could not find the collection owner.",
  },
  sanitize: sanitizeCollectionCreateInput,
  resultKey: "collections",
  ownerCypher: COLLECTION_OWNER_CYPHER,
});

const ownershipCreateMiddleware = {
  Mutation: {
    createAlbums: forceAlbumOwner,
    createCollections: forceCollectionOwner,
  },
};

export default ownershipCreateMiddleware;
