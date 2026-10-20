import type { Driver } from "neo4j-driver";
import { createCollectionReadRepository, type CollectionReadRepository } from "../../services/persistence/collectionReadRepository.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";
import type { CollectionOptions } from "../../src/generated/graphql.js";
import type { CollectionWhere } from "../../ogm_types.js";
import { CollectionVisibility } from "../../ogm_types.js";

type UserCollectionsArgs = {
  driver: Driver;
  collectionReadRepository?: CollectionReadRepository;
};

/**
 * Custom resolver for User.Collections field that filters collections based on:
 * - If requester is the account owner: return ALL collections (public and private)
 * - If requester is NOT the account owner: return only PUBLIC collections
 * - Respects additional where filters passed from GraphQL queries (e.g., filtering by item relationships)
 */
type CollectionsArgs = {
  where?: CollectionWhere;
  options?: { sort?: unknown[]; [key: string]: unknown };
};

export default function ({ driver, collectionReadRepository = createCollectionReadRepository(driver) }: UserCollectionsArgs) {
  return async (
    parent: { username: string },
    args: CollectionsArgs,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const { req } = context;

    // Get the username of the user whose collections we're viewing
    const profileUsername = parent.username;

    // Get the authenticated user making the request
    if (!context.user) {
      context.user = await setUserDataOnContext({
        context,
      });
    }

    const requestingUsername = context.user?.username;
    const isOwnProfile = profileUsername === requestingUsername;


    // Build the filter starting with CreatedBy
    const filter: CollectionWhere = {
      CreatedBy: {
        username: profileUsername
      }
    };

    // Merge incoming where filters from the GraphQL query
    // This allows queries like Collections(where: { Discussions_SOME: { id: $itemId } }) to work
    if (args.where) {
      Object.assign(filter, args.where);
    }

    // If not viewing own profile, only show PUBLIC collections
    // This takes precedence over any visibility filter in args.where
    if (!isOwnProfile) {
      filter.visibility = CollectionVisibility.Public;
    }

    // Merge incoming options with defaults
    const options = args.options || {};
    if (!options.sort) {
      options.sort = [{ createdAt: "DESC" }];
    }

    // Get collections with the merged filter
    // Include all relationship fields that clients might request
    const collections = await collectionReadRepository.findProfileCollections(filter, options as CollectionOptions);

    return collections;
  };
}
