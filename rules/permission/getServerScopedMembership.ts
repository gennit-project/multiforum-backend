import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";
import type { GraphQLContext } from "../../types/context.js";

type EvaluateServerScopedMembershipInput = {
  username?: string | null;
  modProfileName?: string | null;
  email?: string | null;
  cypressAdminTestEmail?: string | null;
  serverAdminUsernames?: string[];
  serverSuperAdminUsernames?: string[];
  serverModeratorDisplayNames?: string[];
};

export type ServerScopedMembership = {
  isServerAdmin: boolean;
  isServerModerator: boolean;
};

export function evaluateServerScopedMembership(
  input: EvaluateServerScopedMembershipInput
): ServerScopedMembership {
  const {
    username,
    modProfileName,
    email,
    cypressAdminTestEmail,
    serverAdminUsernames = [],
    serverSuperAdminUsernames = [],
    serverModeratorDisplayNames = [],
  } = input;

  const isCypressAdmin =
    Boolean(email) &&
    Boolean(cypressAdminTestEmail) &&
    email === cypressAdminTestEmail;

  return {
    // SuperAdmins are admins too (the apex tier); both count as a server admin.
    isServerAdmin:
      isCypressAdmin ||
      (Boolean(username) &&
        (serverAdminUsernames.includes(username as string) ||
          serverSuperAdminUsernames.includes(username as string))),
    isServerModerator:
      Boolean(modProfileName) &&
      serverModeratorDisplayNames.includes(modProfileName as string),
  };
}

export const getServerScopedMembership = async (
  context: GraphQLContext
): Promise<ServerScopedMembership> => {
  if (!context.user?.data) {
    context.user = await setUserDataOnContext({
      context,
    });
  }

  const serverConfig = await getServerConfigForPermissions(context);

  return evaluateServerScopedMembership({
    username: context.user?.username,
    modProfileName: context.user?.data?.ModerationProfile?.displayName,
    email: context.user?.email,
    cypressAdminTestEmail: process.env.CYPRESS_ADMIN_TEST_EMAIL,
    serverAdminUsernames:
      serverConfig?.Admins?.map((admin: { username: string }) => admin.username) ||
      [],
    serverSuperAdminUsernames:
      serverConfig?.SuperAdmins?.map(
        (admin: { username: string }) => admin.username
      ) || [],
    serverModeratorDisplayNames:
      serverConfig?.Moderators?.map(
        (moderator: { displayName: string }) => moderator.displayName
      ) || [],
  });
};
