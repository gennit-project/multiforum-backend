import type { Driver } from "neo4j-driver";
import type { GraphQLContext, Ogm } from "../../types/context.js";
import { SortDirection } from "../../src/generated/graphql.js";
import type { CollectionWhere, ServerConfigModel } from "../../ogm_types.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import { isSensitiveContentTarget } from "../../services/sensitiveContentTarget.js";
import { logger } from "../../logger.js";

type Input = {
  driver: Driver;
  ogm: Ogm;
  ServerConfig?: ServerConfigModel;
};

const itemTypeWhereMap: Record<string, CollectionWhere> = {
  DISCUSSION: { Discussions_SOME: { id: undefined } },
  COMMENT: { Comments_SOME: { id: undefined } },
  DOWNLOAD: { Downloads_SOME: { id: undefined, hasDownload: true } },
  IMAGE: { Images_SOME: { id: undefined } },
  CHANNEL: { Channels_SOME: { uniqueName: undefined } },
};

const selectionSetTemplate = `
{
  id
  name
  description
  visibility
  collectionType
  itemCount
  shareCount
  createdAt
  updatedAt
  itemOrder
  CreatedBy {
    username
    displayName
    profilePicURL
  }
  Downloads(options: { limit: 5 }__DISCUSSION_AGE_FILTER__) {
    id
    title
    createdAt
    hasSensitiveContent
    Album {
      id
      imageOrder
      Images__IMAGE_AGE_FILTER__ {
        id
        url
        caption
      }
    }
    DiscussionChannels {
      id
      channelUniqueName
      CommentsAggregate {
        count
      }
      Channel {
        uniqueName
        displayName
      }
    }
    Tags {
      text
    }
    Author {
      username
      displayName
      profilePicURL
      commentKarma
      discussionKarma
      createdAt
    }
  }
}
`;

const getSelectionSet = (canViewSensitiveContent: boolean) =>
  selectionSetTemplate
    .replace("__DISCUSSION_AGE_FILTER__", canViewSensitiveContent ? "" : ", where: { ageGateSensitive: false }")
    .replace("__IMAGE_AGE_FILTER__", canViewSensitiveContent ? "" : "(where: { ageGateSensitive: false })");

const publicCollectionsContaining = ({ driver, ogm, ServerConfig }: Input) => {
  return async (_parent: unknown, args: { itemId: string; itemType: string }, context: GraphQLContext) => {
    const { itemId, itemType } = args;
    const whereTemplate = itemTypeWhereMap[itemType];

    if (!whereTemplate) {
      throw new Error(`Unsupported itemType: ${itemType}`);
    }

    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver,
      ServerConfig,
    });
    const target = itemType === "DISCUSSION"
      ? { discussionId: itemId }
      : itemType === "DOWNLOAD"
        ? { downloadableFileId: itemId }
      : itemType === "COMMENT"
        ? { commentId: itemId }
        : itemType === "IMAGE"
          ? { imageId: itemId }
          : null;
    if (target && !canViewSensitiveContent && await isSensitiveContentTarget(driver, target)) {
      return [];
    }

    const where = JSON.parse(JSON.stringify(whereTemplate));

    if (itemType === "CHANNEL") {
      where.Channels_SOME.uniqueName = itemId;
    } else {
      const key = Object.keys(where)[0];
      where[key].id = itemId;
    }

    const Collection = ogm.model("Collection");

    try {
      const collections = await Collection.find({
        where: {
          visibility: "PUBLIC",
          ...where,
        },
        options: { sort: [{ createdAt: SortDirection.Desc }] },
        selectionSet: getSelectionSet(canViewSensitiveContent),
      });

      return collections;
    } catch (error) {
      logger.error("Error fetching public collections containing item:", {
        itemId,
        itemType,
        error,
      });
      throw new Error("Failed to fetch public collections containing item");
    }
  };
};

export default publicCollectionsContaining;
