import {
  setUserDataOnContext,
  type AuthContextForUserLookup,
  type UserDataOnContext,
} from "../../rules/permission/userDataHelperFunctions.js";
import { hasServerModPermission } from "../../rules/permission/hasServerModPermission.js";
import type { GraphQLContext } from "../../types/context.js";

type DownloadableFileParent = {
  id?: string | null;
  url?: string | null;
};

type DownloadableFileAccessRecord = {
  url?: string | null;
  scanStatus?: string | null;
  uploadedByUsername?: string | null;
  Discussion?: {
    Author?: { username?: string | null } | null;
  } | null;
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

    const DownloadableFile = context.ogm.model("DownloadableFile");
    const records = await DownloadableFile.find({
      where: { id: parent.id },
      selectionSet: `{
        url
        scanStatus
        uploadedByUsername
        Discussion {
          Author { username }
        }
      }`,
    }) as DownloadableFileAccessRecord[];
    const file = records[0];

    if (!file) {
      return "";
    }

    const username = context.user.username;
    const isOwner =
      file.uploadedByUsername === username ||
      file.Discussion?.Author?.username === username;
    if (isOwner) {
      return file.url || parent.url || "";
    }

    const canReview = await checkServerModPermission(
      "canPermanentlyRemoveImage",
      context
    );
    return canReview === true ? file.url || parent.url || "" : "";
  };
};

export default createDownloadableFileUrlResolver;
