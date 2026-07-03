import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import type {
  ChannelModel,
  CollectionModel,
  DiscussionModel,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  checkChannelPermissions as defaultCheckChannelPermissions,
} from "../../rules/permission/hasChannelPermission.js";
import { createDiscussionsFromInput } from "./createDiscussionWithChannelConnections.js";
import { logger } from "../../logger.js";

type Args = {
  collectionId: string;
  serverId: string;
  title: string;
  content?: string | null;
  shareMessage?: string | null;
};

type CollectionRecord = {
  id: string;
  name: string;
  description?: string | null;
  visibility: string;
  CreatedBy?: {
    username?: string | null;
  } | null;
};

type ChannelRecord = {
  uniqueName: string;
};

type CheckChannelPermissions = typeof defaultCheckChannelPermissions;

type CreateDiscussions = typeof createDiscussionsFromInput;

type Input = {
  Discussion: DiscussionModel;
  Collection: CollectionModel;
  Channel: ChannelModel;
  driver: Driver;
  checkChannelPermissions?: CheckChannelPermissions;
  createDiscussions?: CreateDiscussions;
};

const collectionSelectionSet = `
  {
    id
    name
    description
    visibility
    CreatedBy {
      username
    }
  }
`;

const channelSelectionSet = `
  {
    uniqueName
  }
`;

const getTrimmed = (value: string | null | undefined) => value?.trim() || "";

const getResolver = (input: Input) => {
  const {
    Discussion,
    Collection,
    Channel,
    driver,
    checkChannelPermissions = defaultCheckChannelPermissions,
    createDiscussions = createDiscussionsFromInput,
  } = input;

  return async (
    _parent: unknown,
    args: Args,
    context: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const collectionId = getTrimmed(args.collectionId);
    const channelUniqueName = getTrimmed(args.serverId);
    const title = getTrimmed(args.title);
    const body = getTrimmed(args.shareMessage) || getTrimmed(args.content);

    if (!collectionId) {
      throw new GraphQLError("Collection ID is required.");
    }
    if (!channelUniqueName) {
      throw new GraphQLError("Forum is required.");
    }
    if (!title) {
      throw new GraphQLError("Discussion title is required.");
    }

    context.user = await setUserDataOnContext({
      context,
    });

    const username = context.user?.username;
    if (!username) {
      throw new GraphQLError("You must be logged in to share a collection.");
    }

    const collections = (await Collection.find({
      where: {
        id: collectionId,
        CreatedBy: {
          username,
        },
      },
      selectionSet: collectionSelectionSet,
    })) as CollectionRecord[];

    const collection = collections[0];
    if (!collection) {
      throw new GraphQLError("Collection not found, or you do not own this collection.");
    }

    if (collection.visibility !== "PUBLIC") {
      throw new GraphQLError("Only public collections can be shared to a forum discussion.");
    }

    const channels = (await Channel.find({
      where: {
        uniqueName: channelUniqueName,
      },
      selectionSet: channelSelectionSet,
    })) as ChannelRecord[];

    if (channels.length === 0) {
      throw new GraphQLError("Forum not found.");
    }

    const permissionResult = await checkChannelPermissions({
      channelConnections: [channelUniqueName],
      context,
      permissionCheck: "canCreateDiscussion",
    });

    if (permissionResult instanceof Error) {
      throw new GraphQLError(permissionResult.message);
    }

    try {
      const discussions = await createDiscussions(
        Discussion,
        driver,
        [
          {
            discussionCreateInput: {
              title,
              body,
              hasDownload: false,
              Author: {
                connect: {
                  where: {
                    node: {
                      username,
                    },
                  },
                },
              },
              SharedCollection: {
                connect: {
                  where: {
                    node: {
                      id: collectionId,
                    },
                  },
                },
              },
            },
            channelConnections: [channelUniqueName],
          },
        ],
        context
      );

      return discussions[0];
    } catch (error: unknown) {
      logger.error("Error sharing collection as discussion:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphQLError(`Failed to share collection: ${message}`);
    }
  };
};

export default getResolver;
