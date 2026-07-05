import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { ChannelModel, WikiPageModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { checkChannelPermissions } from "../../rules/permission/hasChannelPermission.js";

type PinWikiPageArgs = {
  channelUniqueName: string;
  wikiPageId: string;
};

type PermissionCheck = typeof checkChannelPermissions;

type Deps = {
  driver: Driver;
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
  Channel,
  WikiPage,
  args,
}: {
  Channel: ChannelModel;
  WikiPage: WikiPageModel;
  args: PinWikiPageArgs;
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
  Channel,
  WikiPage,
  checkPermissions = checkChannelPermissions,
}: Deps) => {
  return async (_parent: unknown, args: PinWikiPageArgs, context: GraphQLContext) => {
    validateArgs(args);
    await getChannelAndWikiPage({ Channel, WikiPage, args });
    await assertCanPinWikiPage({ args, context, checkPermissions });

    const session = driver.session({ defaultAccessMode: "WRITE" });

    try {
      await session.run(
        `
        MATCH (channel:Channel { uniqueName: $channelUniqueName })
        MATCH (wikiPage:WikiPage { id: $wikiPageId, channelUniqueName: $channelUniqueName })
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
  Channel,
  WikiPage,
  checkPermissions = checkChannelPermissions,
}: Deps) => {
  return async (_parent: unknown, args: PinWikiPageArgs, context: GraphQLContext) => {
    validateArgs(args);
    await getChannelAndWikiPage({ Channel, WikiPage, args });
    await assertCanPinWikiPage({ args, context, checkPermissions });

    const session = driver.session({ defaultAccessMode: "WRITE" });

    try {
      await session.run(
        `
        MATCH (:Channel { uniqueName: $channelUniqueName })-[relationship:PINNED_IN_CHANNEL]->(:WikiPage { id: $wikiPageId, channelUniqueName: $channelUniqueName })
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
