import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { UserWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";

interface IsAccountOwnerArgs {
  where: UserWhere;
  username: string;
}
// Check if the user is the owner of the account.
export const isAccountOwner = rule({ cache: "contextual" })(
  async (parent: { username?: string } | undefined, args: IsAccountOwnerArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    // When accessing nested fields like FavoriteChannels, the username comes from the parent User object
    const username  = parent?.username || args.where?.username || args.username;

    // set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    if (!username) {
      throw new Error(ERROR_MESSAGES.user.noUsername);
    }

    // Check if the user is the account owner.
    if (username !== ctx.user.username) {
      throw new Error(ERROR_MESSAGES.user.notOwner);
    }

    return true;
  }
);
