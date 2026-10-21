import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import { createWikiPinRepository, type WikiPinRepository } from "../../services/persistence/wikiActionRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import { checkChannelPermissions } from "../../rules/permission/hasChannelPermission.js";

type PinWikiPageArgs = {
  channelUniqueName: string;
  wikiPageId: string;
};

type PermissionCheck = typeof checkChannelPermissions;

type Deps = {
  driver: Driver;
  repository?: WikiPinRepository;
  checkPermissions?: PermissionCheck;
};

const validateArgs = (args: PinWikiPageArgs) => {
  if (!args.channelUniqueName) {
    throw new GraphQLError("A forum is required to pin a wiki page.");
  }

  if (!args.wikiPageId) {
    throw new GraphQLError("A wiki page is required.");
  }
};

const getChannelAndWikiPage = async ({
  repository,
  args,
}: {
  repository: WikiPinRepository;
  args: PinWikiPageArgs;
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
};

const assertCanPinWikiPage = async ({
  args,
  context,
  checkPermissions,
}: {
  args: PinWikiPageArgs;
  context: GraphQLContext;
  checkPermissions: PermissionCheck;
}) => {
  const permissionResult = await checkPermissions({
    channelConnections: [args.channelUniqueName],
    context,
    permissionCheck: "canUpdateChannel",
  });

  if (permissionResult instanceof Error) {
    throw new GraphQLError(permissionResult.message);
  }
};

export const pinWikiPageToChannel = ({
  driver,
  repository: injectedRepository,
  checkPermissions = checkChannelPermissions,
}: Deps) => {
  const repository = injectedRepository ?? createWikiPinRepository(driver);
  return async (_parent: unknown, args: PinWikiPageArgs, context: GraphQLContext) => {
    validateArgs(args);
    await getChannelAndWikiPage({ repository, args });
    await assertCanPinWikiPage({ args, context, checkPermissions });

    const session = driver.session({ defaultAccessMode: "WRITE" });

    try {
      await session.run(
        `
        MATCH (channel:Channel { uniqueName: $channelUniqueName })-[:OWNS_WIKI_PAGE]->(wikiPage:WikiPage { id: $wikiPageId })
        MERGE (channel)-[:PINNED_IN_CHANNEL]->(wikiPage)
        `,
        args
      );

      return true;
    } finally {
      await session.close();
    }
  };
};

export const unpinWikiPageFromChannel = ({
  driver,
  repository: injectedRepository,
  checkPermissions = checkChannelPermissions,
}: Deps) => {
  const repository = injectedRepository ?? createWikiPinRepository(driver);
  return async (_parent: unknown, args: PinWikiPageArgs, context: GraphQLContext) => {
    validateArgs(args);
    await getChannelAndWikiPage({ repository, args });
    await assertCanPinWikiPage({ args, context, checkPermissions });

    const session = driver.session({ defaultAccessMode: "WRITE" });

    try {
      await session.run(
        `
        MATCH (:Channel { uniqueName: $channelUniqueName })-[:OWNS_WIKI_PAGE]->(wikiPage:WikiPage { id: $wikiPageId })
        MATCH (:Channel { uniqueName: $channelUniqueName })-[relationship:PINNED_IN_CHANNEL]->(wikiPage)
        DELETE relationship
        `,
        args
      );

      return true;
    } finally {
      await session.close();
    }
  };
};
