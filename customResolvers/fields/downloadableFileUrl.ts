import {
  setUserDataOnContext,
  type AuthContextForUserLookup,
  type UserDataOnContext,
} from "../../rules/permission/userDataHelperFunctions.js";
import { hasServerModPermission } from "../../rules/permission/hasServerModPermission.js";
import type { GraphQLContext } from "../../types/context.js";
import { resolveDownloadableFileRepository } from "../../services/persistence/downloadableFileRepository.js";

type DownloadableFileParent = {
  id?: string | null;
  url?: string | null;
};

type DownloadableFileContext = GraphQLContext &
  AuthContextForUserLookup & {
    user?: UserDataOnContext | null;
    jwtError?: Error | null;
  };

type SetUserDataOnContext = typeof setUserDataOnContext;
type CheckServerModPermission = typeof hasServerModPermission;

export const createDownloadableFileUrlResolver = (
  getUserData: SetUserDataOnContext = setUserDataOnContext,
  checkServerModPermission: CheckServerModPermission = hasServerModPermission
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
      });
    }

    if (!context.user?.username) {
      return "";
    }

    if (!parent.id) {
      return "";
    }

    const file = await resolveDownloadableFileRepository(context).findUrlAccess(parent.id);

    if (!file) {
      return "";
    }

    const username = context.user.username;
    const isOwner =
      file.uploadedByUsername === username ||
      file.discussionAuthorUsername === username;
    // The production OGM shared the application schema: its context-free
    // lookup invoked this URL resolver anonymously and returned an empty URL.
    // Authorized callers therefore received the parent URL, never a fresh
    // storage URL. Keep that behavior without the nested GraphQL execution.
    if (isOwner) {
      return parent.url || "";
    }

    const canReview = await checkServerModPermission(
      "canPermanentlyRemoveImage",
      context
    );
    return canReview === true ? parent.url || "" : "";
  };
};

export default createDownloadableFileUrlResolver;
