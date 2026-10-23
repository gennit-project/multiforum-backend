import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { createCollectionReadRepository, type CollectionReadRepository } from "../../services/persistence/collectionReadRepository.js";
export { getPublicCollectionSelectionSet } from "../../services/persistence/collectionReadRepository.js";
import type { CollectionWhere } from "../../ogm_types.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import { isSensitiveContentTarget } from "../../services/sensitiveContentTarget.js";
import { logger } from "../../logger.js";

type Input = {
  driver: Driver;
  collectionReadRepository?: CollectionReadRepository;
  agePolicyRepository?: AgePolicyReader;
};

const itemTypeWhereMap: Record<string, CollectionWhere> = {
  DISCUSSION: { Discussions_SOME: { id: { eq: undefined } } },
  COMMENT: { Comments_SOME: { id: { eq: undefined } } },
  DOWNLOAD: { Downloads_SOME: { id: { eq: undefined }, hasDownload: { eq: true } } },
  IMAGE: { Images_SOME: { id: { eq: undefined } } },
  CHANNEL: { Channels_SOME: { uniqueName: { eq: undefined } } },
};

const publicCollectionsContaining = ({ driver, collectionReadRepository = createCollectionReadRepository(driver), agePolicyRepository }: Input) => {
  return async (_parent: unknown, args: { itemId: string; itemType: string }, context: GraphQLContext) => {
    const { itemId, itemType } = args;
    const whereTemplate = itemTypeWhereMap[itemType];

    if (!whereTemplate) {
      throw new Error(`Unsupported itemType: ${itemType}`);
    }

    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver,
      agePolicyRepository,
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
      where.Channels_SOME.uniqueName.eq = itemId;
    } else {
      const key = Object.keys(where)[0];
      where[key].id.eq = itemId;
    }


    try {
      const collections = await collectionReadRepository.findPublicContaining({
        visibility: { eq: "PUBLIC" },
        ...where,
      }, canViewSensitiveContent);

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
