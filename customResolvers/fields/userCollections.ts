import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext, Ogm } from "../../types/context.js";
import type { CollectionOptions } from "../../src/generated/graphql.js";

type UserCollectionsArgs = {
  ogm: Ogm;
};

/**
 * Custom resolver for User.Collections field that filters collections based on:
 * - If requester is the account owner: return ALL collections (public and private)
 * - If requester is NOT the account owner: return only PUBLIC collections
 * - Respects additional where filters passed from GraphQL queries (e.g., filtering by item relationships)
 */
type CollectionsArgs = {
  where?: Record<string, unknown>;
  options?: { sort?: unknown[]; [key: string]: unknown };
};

export default function ({ ogm }: UserCollectionsArgs) {
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
        getPermissionInfo: false,
      });
    }

    const requestingUsername = context.user?.username;
    const isOwnProfile = profileUsername === requestingUsername;

    const Collection = ogm.model("Collection");

    // Build the filter starting with CreatedBy
    const filter: Record<string, unknown> = {
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
      filter.visibility = "PUBLIC";
    }

    // Merge incoming options with defaults
    const options = args.options || {};
    if (!options.sort) {
      options.sort = [{ createdAt: "DESC" }];
    }

    // Get collections with the merged filter
    // Include all relationship fields that clients might request
    const collections = await Collection.find({
      where: filter,
      selectionSet: `{
        id
        name
        description
        visibility
        collectionType
        itemCount
        itemOrder
        createdAt
        updatedAt
        Channels {
          uniqueName
          displayName
          channelIconURL
        }
        Discussions {
          id
          title
        }
        Comments {
          id
          text
        }
        Downloads {
          id
          title
        }
        Images {
          id
          url
        }
      }`,
      options: options as CollectionOptions
    });

    return collections;
  };
}
