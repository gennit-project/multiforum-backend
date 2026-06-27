import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { getServerConfigForPermissions } from "../permission/getServerConfigForPermissions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";

// Server-side enforcement of the `ServerConfig.enableDownloads` feature flag.
//
// A "download" is a Discussion created with `hasDownload: true` (the custom
// createDiscussionWithChannelConnections resolver attaches a DownloadableFile and
// runs the channel plugin pipeline for those). The frontend already hides the
// downloads tab + create UI when `enableDownloads` is not true, but that gate is
// cosmetic — a direct API call could still create a download. This rule closes
// that gap.
//
// Semantics match the frontend's `Boolean(enableDownloads)`: downloads are
// allowed ONLY when the flag is explicitly `true`. A server whose downloads tab
// is currently visible already has `enableDownloads === true`, so this does not
// regress any instance that legitimately offers downloads today; it only blocks
// direct-API creation on servers where downloads are off (null/false).

type CreateDiscussionItem = {
  discussionCreateInput?: { hasDownload?: boolean | null } | null;
  channelConnections?: string[];
};

export type CreateDiscussionArgs = {
  input?: CreateDiscussionItem[] | null;
};

/** True when any item in the create input attaches a download. */
export const inputCreatesDownload = (
  input: CreateDiscussionItem[] | null | undefined
): boolean =>
  Array.isArray(input) &&
  input.some((item) => item?.discussionCreateInput?.hasDownload === true);

/**
 * Pure decision: allow unless the input creates a download AND the server does
 * not have downloads enabled. Returns `true` to allow, or an error message.
 */
export const evaluateServerDownloadsEnabled = ({
  input,
  enableDownloads,
}: {
  input: CreateDiscussionItem[] | null | undefined;
  enableDownloads: boolean | null | undefined;
}): true | string => {
  if (!inputCreatesDownload(input)) {
    return true; // Not a download — this rule is a no-op.
  }
  return enableDownloads === true ? true : ERROR_MESSAGES.download.notEnabled;
};

export const serverDownloadsEnabled = rule({ cache: "contextual" })(
  async (
    _parent: unknown,
    args: CreateDiscussionArgs,
    ctx: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    // Avoid the ServerConfig read entirely when no download is being created.
    if (!inputCreatesDownload(args.input)) {
      return true;
    }
    const serverConfig = await getServerConfigForPermissions(ctx);
    const result = evaluateServerDownloadsEnabled({
      input: args.input,
      enableDownloads: serverConfig?.enableDownloads,
    });
    return result === true ? true : new Error(result);
  }
);
