import {
  setUserDataOnContext,
  type AuthContextForUserLookup,
  type UserDataOnContext,
} from "../../rules/permission/userDataHelperFunctions.js";

type DownloadableFileParent = {
  url?: string | null;
};

type DownloadableFileContext = {
  user?: UserDataOnContext | null;
  jwtError?: Error | null;
} & AuthContextForUserLookup;

type SetUserDataOnContext = typeof setUserDataOnContext;

export const createDownloadableFileUrlResolver = (
  getUserData: SetUserDataOnContext = setUserDataOnContext
) => {
  return async (
    parent: DownloadableFileParent,
    _args: unknown,
    context: DownloadableFileContext
  ): Promise<string> => {
    if (context.jwtError) {
      return "";
    }

    if (!context.user) {
      context.user = await getUserData({
        context,
        getPermissionInfo: false,
      });
    }

    if (!context.user?.username) {
      return "";
    }

    return parent.url || "";
  };
};

export default createDownloadableFileUrlResolver;
