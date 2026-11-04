import { accountChildIdentity } from "../../services/accountChildIdentity.js";
import { ERROR_MESSAGES } from "../../rules/errorMessages.js";
import type { Driver } from "neo4j-driver";
import { createCollectionReadRepository, type CollectionReadRepository, type CollectionReadOptions } from "../../services/persistence/collectionReadRepository.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";
import type { CollectionWhere, UserCollectionsArgs as CollectionsArgs } from "../../src/generated/graphql.js";
import { SortDirection } from "../../src/generated/graphql.js";
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
export default function ({ driver, collectionReadRepository = createCollectionReadRepository(driver) }: UserCollectionsArgs) {
  return async (
    parent: { username?: unknown },
    args: CollectionsArgs,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {

    // Get the username of the user whose collections we're viewing
    const selectedIdentity = accountChildIdentity(parent);
    const profileUsername = selectedIdentity.found ? selectedIdentity.value : parent.username;
    if (typeof profileUsername !== "string" || !profileUsername) {
      throw new Error(ERROR_MESSAGES.user.noUsername);
    }

    // Get the authenticated user making the request
    if (!context.user) {
      context.user = await setUserDataOnContext({
        context,
      });
    }

    const requestingUsername = context.user?.username;
    const isOwnProfile = profileUsername === requestingUsername;


    // Caller filters can narrow the authorized set, never replace its scope.
    const authorized: CollectionWhere = {
      CreatedBy: { username: { eq: profileUsername } },
      ...(!isOwnProfile ? { visibility: { eq: CollectionVisibility.Public } } : {}),
    };
    const filter: CollectionWhere = args.where ? { AND: [authorized, args.where] } : authorized;
    const options: CollectionReadOptions = {
      sort: args.sort ?? [{ createdAt: SortDirection.Desc }],
      ...(args.limit != null ? { limit: args.limit } : {}),
      ...(args.offset != null ? { offset: args.offset } : {}),
    };
    const collections = await collectionReadRepository.findProfileCollections(filter, options, requestingUsername ?? undefined);

    return collections;
  };
}
