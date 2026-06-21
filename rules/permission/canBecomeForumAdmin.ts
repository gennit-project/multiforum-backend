import { rule } from "graphql-shield";
import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { channelHasZeroAdmins } from "./channelHasZeroAdmins.js";

type CanBecomeForumAdminArgs = {
  channelUniqueName: string;
};

// Pure decision for becoming a forum admin. Throws the same errors the rule
// surfaces and returns true only when every condition passes. The async
// lookups (authenticated user, channel admin count) stay in the rule below so
// this stays unit-testable.
export function evaluateCanBecomeForumAdmin(input: {
  channelUniqueName?: string;
  username?: string;
  hasZeroAdmins: boolean;
}): true {
  if (!input.channelUniqueName) {
    throw new Error("channelUniqueName is required");
  }

  if (!input.username) {
    throw new Error("User must be authenticated");
  }

  if (!input.hasZeroAdmins) {
    throw new Error(
      "Cannot become admin: this forum already has one or more admins"
    );
  }

  return true;
}

export const canBecomeForumAdmin = rule({ cache: "contextual" })(
  async (
    parent: any,
    args: CanBecomeForumAdminArgs,
    context: any,
    info: any
  ) => {
    const { channelUniqueName } = args;

    // Only fetch the user once a channel was supplied, so the "channelUniqueName
    // is required" error still takes precedence (matches the original order).
    if (channelUniqueName) {
      context.user = await setUserDataOnContext({
        context,
        getPermissionInfo: false,
      });
    }

    const username = context.user?.username;

    // Only check admin count when the earlier conditions hold, so an
    // unauthenticated request fails before this lookup (as it did originally).
    const hasZeroAdmins =
      channelUniqueName && username
        ? await channelHasZeroAdmins({
            channelName: channelUniqueName,
            context,
          })
        : false;

    return evaluateCanBecomeForumAdmin({
      channelUniqueName,
      username,
      hasZeroAdmins,
    });
  }
);
