import {createDiscussionCreationRepository, type DiscussionCreationRepository} from "../../services/persistence/discussionCreationRepository.js";
import { createCollectionReadRepository, type CollectionReadRepository } from "../../services/persistence/collectionReadRepository.js";
import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
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
  flairIds?: string[] | null;
};

type CheckChannelPermissions = typeof defaultCheckChannelPermissions;

type CreateDiscussions = typeof createDiscussionsFromInput;

type Input = {
  discussionCreationRepository?: DiscussionCreationRepository;
  collectionReadRepository?: CollectionReadRepository;
  driver: Driver;
  checkChannelPermissions?: CheckChannelPermissions;
  createDiscussions?: CreateDiscussions;
};

const getTrimmed = (value: string | null | undefined) => value?.trim() || "";

const getResolver = (input: Input) => {
  const {
    driver,
    checkChannelPermissions = defaultCheckChannelPermissions,
    createDiscussions = createDiscussionsFromInput,
  } = input;
  const repository = input.discussionCreationRepository ?? createDiscussionCreationRepository(driver);
  const collectionsRepository = input.collectionReadRepository ?? createCollectionReadRepository(driver);

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
    const flairIds = args.flairIds ?? [];

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

    const collections = await collectionsRepository.findOwnedShareTarget(collectionId, username);

    const collection = collections[0];
    if (!collection) {
      throw new GraphQLError("Collection not found, or you do not own this collection.");
    }

    if (collection.visibility !== "PUBLIC") {
      throw new GraphQLError("Only public collections can be shared to a forum discussion.");
    }

    const channels = await collectionsRepository.findShareChannel(channelUniqueName);

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
        repository,
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
            channelFlairSelections: [
              { channelUniqueName, flairIds },
            ],
          },
        ],
        context
      );

      return discussions[0];
    } catch (error: unknown) {
      logger.error("Error sharing collection as discussion:", error);
      if (error instanceof GraphQLError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphQLError(`Failed to share collection: ${message}`);
    }
  };
};

export default getResolver;
