import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";

type ServerRoleLike = {
  showAdminTag?: boolean | null;
};

type EvaluateServerScopedMembershipInput = {
  username?: string | null;
  modProfileName?: string | null;
  email?: string | null;
  cypressAdminTestEmail?: string | null;
  serverAdminUsernames?: string[];
  serverModeratorDisplayNames?: string[];
  legacyServerRoles?: ServerRoleLike[];
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
    serverModeratorDisplayNames = [],
    legacyServerRoles = [],
  } = input;

  const isLegacyAdmin = legacyServerRoles.some(
    (role) => role.showAdminTag === true
  );
  const isCypressAdmin =
    Boolean(email) &&
    Boolean(cypressAdminTestEmail) &&
    email === cypressAdminTestEmail;

  return {
    isServerAdmin:
      isCypressAdmin ||
      (Boolean(username) && serverAdminUsernames.includes(username as string)) ||
      isLegacyAdmin,
    isServerModerator:
      Boolean(modProfileName) &&
      serverModeratorDisplayNames.includes(modProfileName as string),
  };
}

export const getServerScopedMembership = async (
  context: any
): Promise<ServerScopedMembership> => {
  if (!context.user?.data) {
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: true,
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
    serverModeratorDisplayNames:
      serverConfig?.Moderators?.map(
        (moderator: { displayName: string }) => moderator.displayName
      ) || [],
    legacyServerRoles: context.user?.data?.ServerRoles || [],
  });
};
