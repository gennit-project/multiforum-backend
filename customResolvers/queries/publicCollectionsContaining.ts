type Input = {
  driver: any;
};

type RelationshipConfig = {
  relationshipType: string;
  nodeLabel: string;
  extraWhere?: string;
};

const relationshipConfig: Record<string, RelationshipConfig> = {
  DISCUSSION: {
    relationshipType: "CONTAINS_DISCUSSION",
    nodeLabel: "Discussion"
  },
  COMMENT: {
    relationshipType: "CONTAINS_COMMENT",
    nodeLabel: "Comment"
  },
  DOWNLOAD: {
    relationshipType: "CONTAINS_DOWNLOAD",
    nodeLabel: "Discussion",
    extraWhere: "AND coalesce(item.hasDownload, false) = true"
  },
  IMAGE: {
    relationshipType: "CONTAINS_IMAGE",
    nodeLabel: "Image"
  },
  CHANNEL: {
    relationshipType: "CONTAINS_CHANNEL",
    nodeLabel: "Channel"
  }
};

const publicCollectionsContaining = ({ driver }: Input) => {
  return async (_parent: any, args: any) => {
    const { itemId, itemType } = args;
    const config = relationshipConfig[itemType];

    if (!config) {
      throw new Error(`Unsupported itemType: ${itemType}`);
    }

    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (c:Collection {visibility: 'PUBLIC'})-[:${config.relationshipType}]->(item:${config.nodeLabel})
        WHERE item.id = $itemId ${config.extraWhere ? config.extraWhere : ""}

        CALL {
          WITH c
          OPTIONAL MATCH (c)-[:CONTAINS_DISCUSSION|CONTAINS_COMMENT|CONTAINS_DOWNLOAD|CONTAINS_IMAGE|CONTAINS_CHANNEL]->(collectionItem)
          RETURN count(DISTINCT collectionItem) AS itemCount
        }

        CALL {
          WITH c
          OPTIONAL MATCH (c)<-[:SHARES_COLLECTION]-(sharingDiscussion:Discussion)
          RETURN count(DISTINCT sharingDiscussion) AS shareCount
        }

        OPTIONAL MATCH (c)-[:CREATED_BY]->(creator:User)

        RETURN {
          id: c.id,
          name: c.name,
          description: c.description,
          visibility: c.visibility,
          collectionType: c.collectionType,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          itemOrder: c.itemOrder,
          itemCount: itemCount,
          shareCount: shareCount,
          CreatedBy: CASE
            WHEN creator IS NULL THEN NULL
            ELSE {
              id: creator.id,
              username: creator.username,
              displayName: creator.displayName,
              profilePicURL: creator.profilePicURL
            }
          END
        } AS collection
        ORDER BY c.createdAt DESC
        `,
        { itemId }
      );

      return result.records.map((record: any) => record.get("collection"));
    } catch (error) {
      console.error("Error fetching public collections containing item:", {
        itemId,
        itemType,
        error,
      });
      throw new Error("Failed to fetch public collections containing item");
    } finally {
      await session.close();
    }
  };
};

export default publicCollectionsContaining;
