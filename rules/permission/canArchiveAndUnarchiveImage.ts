import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import { hasServerModPermission } from "./hasServerModPermission.js";
import { rule } from "graphql-shield";

export interface CanArchiveAndUnarchiveImageArgs {
  channelUniqueName?: string | null;
  imageId?: string;
}

export const canArchiveAndUnarchiveImage = rule({ cache: "contextual" })(
  async (
    parent: any,
    args: CanArchiveAndUnarchiveImageArgs,
    context: any,
    info: any
  ) => {
    const channelUniqueName = args.channelUniqueName;
    const imageId = args.imageId;

    // Server-scoped image archival (no channel specified)
    if (!channelUniqueName) {
      // For server-scoped operations, check server mod permission
      const permissionResult = await hasServerModPermission(
        "canArchiveImage",
        context
      );

      if (permissionResult instanceof Error) {
        return permissionResult;
      }

      return true;
    }

    // Channel-scoped image archival
    const permissionResult = await checkChannelModPermissions({
      channelConnections: [channelUniqueName],
      context,
      permissionCheck: ModChannelPermission.canArchiveImage,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);
