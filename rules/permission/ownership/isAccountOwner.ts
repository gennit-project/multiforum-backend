import { accountChildIdentity } from "../../../services/accountChildIdentity.js";
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
// Compare on every field/operation. Strict hashing walks arbitrary parent values
// (including Neo4j Integer constructors), which can throw before authorization.
// Authentication remains request-cached in setUserDataOnContext; no permission
// result is shared between different parents or mutation arguments.
export const isAccountOwner = rule({ cache: "no_cache" })(
  async (parent: { username?: string } | undefined, args: IsAccountOwnerArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    // When accessing nested fields like FavoriteChannels, the username comes from the parent User object.
    // v7 nests the filter as where.username = { eq: "..." } (StringScalarFilters); tolerate the old flat string too.
    const whereUsername = args.where?.username as string | { eq?: string | null } | null | undefined;
    const selectedIdentity = parent && accountChildIdentity(parent);
    const username = selectedIdentity?.found ? selectedIdentity.value : parent?.username ||
      (typeof whereUsername === "string" ? whereUsername : whereUsername?.eq) ||
      args.username;

    // set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
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
