import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

type UserCollectionsArgs = {
  ogm: any;
};

/**
 * Custom resolver for User.Collections field that filters collections based on:
 * - If requester is the account owner: return ALL collections (public and private)
 * - If requester is NOT the account owner: return only PUBLIC collections
 * - Respects additional where filters passed from GraphQL queries (e.g., filtering by item relationships)
 */
export default function ({ ogm }: UserCollectionsArgs) {
  return async (parent: any, args: any, context: any, info: any) => {
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
    const filter: any = {
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
    const collections = await Collection.find({
      where: filter,
      selectionSet: `{
        id
        name
        description
        visibility
        collectionType
        itemCount
        createdAt
        updatedAt
      }`,
      options
    });

    return collections;
  };
}
