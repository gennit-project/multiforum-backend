import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

type UserCollectionsArgs = {
  ogm: any;
};

/**
 * Custom resolver for User.Collections field that filters collections based on:
 * - If requester is the account owner: return ALL collections (public and private)
 * - If requester is NOT the account owner: return only PUBLIC collections
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

    // Build the filter
    const filter: any = {
      CreatedBy: {
        username: profileUsername
      }
    };

    // If not viewing own profile, only show PUBLIC collections
    if (!isOwnProfile) {
      filter.visibility = "PUBLIC";
    }

    // Get collections with the filter
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
      options: {
        sort: [{ createdAt: "DESC" }]
      }
    });

    return collections;
  };
}
