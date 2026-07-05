import { GraphQLError } from "graphql";
import type { ChannelModel, WikiPageModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  checkChannelModPermissions,
  ModChannelPermission,
} from "../../rules/permission/hasChannelModPermission.js";

type LockWikiPageArgs = {
  channelUniqueName: string;
  wikiPageId: string;
  reason?: string | null;
};

type UnlockWikiPageArgs = {
  channelUniqueName: string;
  wikiPageId: string;
};

type PermissionCheck = typeof checkChannelModPermissions;

type Deps = {
  Channel: ChannelModel;
  WikiPage: WikiPageModel;
  checkPermissions?: PermissionCheck;
};

type ChannelLookup = {
  uniqueName?: string | null;
  wikiEnabled?: boolean | null;
};

type WikiPageLookup = {
  id?: string | null;
  channelUniqueName?: string | null;
  locked?: boolean | null;
};

type WikiPageLockUpdate = {
  locked: boolean;
  lockedAt: string | null;
  lockReason: string | null;
  lockedByUsername: string | null;
};

const returnedWikiPageSelectionSet = `{
  wikiPages {
    id
    title
    body
    slug
    channelUniqueName
    locked
    lockedAt
    lockReason
    lockedByUsername
  }
}`;

const validateBaseArgs = (args: UnlockWikiPageArgs) => {
  if (!args.channelUniqueName) {
    throw new GraphQLError("A forum is required.");
  }

  if (!args.wikiPageId) {
    throw new GraphQLError("A wiki page is required.");
  }
};

const getChannelAndWikiPage = async ({
  Channel,
  WikiPage,
  args,
}: {
  Channel: ChannelModel;
  WikiPage: WikiPageModel;
  args: UnlockWikiPageArgs;
}) => {
  const [channels, wikiPages] = await Promise.all([
    Channel.find({
      where: { uniqueName: args.channelUniqueName },
      selectionSet: `{
        uniqueName
        wikiEnabled
      }`,
    }) as Promise<ChannelLookup[]>,
    WikiPage.find({
      where: { id: args.wikiPageId },
      selectionSet: `{
        id
        channelUniqueName
        locked
      }`,
    }) as Promise<WikiPageLookup[]>,
  ]);

  const channel = channels[0];
  const wikiPage = wikiPages[0];

  if (!channel) {
    throw new GraphQLError("Forum not found.");
  }

  if (channel.wikiEnabled === false) {
    throw new GraphQLError(`Wiki is disabled in channel '${args.channelUniqueName}'.`);
  }

  if (!wikiPage) {
    throw new GraphQLError("Wiki page not found.");
  }

  if (wikiPage.channelUniqueName !== args.channelUniqueName) {
    throw new GraphQLError("Wiki page does not belong to this forum.");
  }

  return wikiPage;
};

const assertCanManageWikiPageLock = async ({
  args,
  context,
  checkPermissions,
}: {
  args: UnlockWikiPageArgs;
  context: GraphQLContext;
  checkPermissions: PermissionCheck;
}) => {
  const permissionResult = await checkPermissions({
    channelConnections: [args.channelUniqueName],
    context,
    permissionCheck: ModChannelPermission.canDeleteWiki,
  });

  if (permissionResult instanceof Error) {
    throw new GraphQLError(permissionResult.message);
  }
};

const updateWikiPageLock = async ({
  WikiPage,
  args,
  update,
}: {
  WikiPage: WikiPageModel;
  args: UnlockWikiPageArgs;
  update: WikiPageLockUpdate;
}) => {
  const result = await WikiPage.update({
    where: { id: args.wikiPageId },
    update: update as never,
    selectionSet: returnedWikiPageSelectionSet,
  });

  const wikiPage = result.wikiPages[0];

  if (!wikiPage) {
    throw new GraphQLError("Wiki page could not be updated.");
  }

  return wikiPage;
};

export const lockWikiPage = ({
  Channel,
  WikiPage,
  checkPermissions = checkChannelModPermissions,
}: Deps) => {
  return async (_parent: unknown, args: LockWikiPageArgs, context: GraphQLContext) => {
    validateBaseArgs(args);

    const reason = args.reason?.trim();
    if (!reason) {
      throw new GraphQLError("A lock reason is required.");
    }

    const wikiPage = await getChannelAndWikiPage({ Channel, WikiPage, args });
    if (wikiPage.locked === true) {
      throw new GraphQLError("Wiki page is already locked.");
    }

    await assertCanManageWikiPageLock({ args, context, checkPermissions });

    const username = context.user?.username;
    if (!username) {
      throw new GraphQLError("User must be logged in.");
    }

    return updateWikiPageLock({
      WikiPage,
      args,
      update: {
        locked: true,
        lockedAt: new Date().toISOString(),
        lockReason: reason,
        lockedByUsername: username,
      },
    });
  };
};

export const unlockWikiPage = ({
  Channel,
  WikiPage,
  checkPermissions = checkChannelModPermissions,
}: Deps) => {
  return async (_parent: unknown, args: UnlockWikiPageArgs, context: GraphQLContext) => {
    validateBaseArgs(args);

    const wikiPage = await getChannelAndWikiPage({ Channel, WikiPage, args });
    if (wikiPage.locked !== true) {
      throw new GraphQLError("Wiki page is not locked.");
    }

    await assertCanManageWikiPageLock({ args, context, checkPermissions });

    return updateWikiPageLock({
      WikiPage,
      args,
      update: {
        locked: false,
        lockedAt: null,
        lockReason: null,
        lockedByUsername: null,
      },
    });
  };
};
