import type { Driver } from "neo4j-driver";
import { GraphQLError } from "graphql";
import { createWikiLockRepository, type WikiLockRepository } from "../../services/persistence/wikiActionRepository.js";
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
  driver: Driver;
  repository?: WikiLockRepository;
  checkPermissions?: PermissionCheck;
};

const validateBaseArgs = (args: UnlockWikiPageArgs) => {
  if (!args.channelUniqueName) {
    throw new GraphQLError("A forum is required.");
  }

  if (!args.wikiPageId) {
    throw new GraphQLError("A wiki page is required.");
  }
};

const getChannelAndWikiPage = async ({
  repository,
  args,
}: {
  repository: WikiLockRepository;
  args: UnlockWikiPageArgs;
}) => {
  const [channels, wikiPages] = await Promise.all([
    repository.findChannel(args.channelUniqueName),
    repository.findPage(args.wikiPageId),
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

  if (wikiPage.Channel?.uniqueName !== args.channelUniqueName) {
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
  repository,
  args,
  update,
}: {
  repository: WikiLockRepository;
  args: UnlockWikiPageArgs;
  update: Parameters<WikiLockRepository["updateLock"]>[1];
}) => {
  const result = await repository.updateLock(args.wikiPageId, update);

  const wikiPage = result.wikiPages[0];

  if (!wikiPage) {
    throw new GraphQLError("Wiki page could not be updated.");
  }

  return wikiPage;
};

export const lockWikiPage = ({
  driver,
  repository: injectedRepository,
  checkPermissions = checkChannelModPermissions,
}: Deps) => {
  const repository = injectedRepository ?? createWikiLockRepository(driver);
  return async (_parent: unknown, args: LockWikiPageArgs, context: GraphQLContext) => {
    validateBaseArgs(args);

    const reason = args.reason?.trim();
    if (!reason) {
      throw new GraphQLError("A lock reason is required.");
    }

    const wikiPage = await getChannelAndWikiPage({ repository, args });
    if (wikiPage.locked === true) {
      throw new GraphQLError("Wiki page is already locked.");
    }

    await assertCanManageWikiPageLock({ args, context, checkPermissions });

    const username = context.user?.username;
    if (!username) {
      throw new GraphQLError("User must be logged in.");
    }

    return updateWikiPageLock({
      repository,
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
  driver,
  repository: injectedRepository,
  checkPermissions = checkChannelModPermissions,
}: Deps) => {
  const repository = injectedRepository ?? createWikiLockRepository(driver);
  return async (_parent: unknown, args: UnlockWikiPageArgs, context: GraphQLContext) => {
    validateBaseArgs(args);

    const wikiPage = await getChannelAndWikiPage({ repository, args });
    if (wikiPage.locked !== true) {
      throw new GraphQLError("Wiki page is not locked.");
    }

    await assertCanManageWikiPageLock({ args, context, checkPermissions });

    return updateWikiPageLock({
      repository,
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
