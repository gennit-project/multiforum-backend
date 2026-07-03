import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";

type CollectionItemType = "DISCUSSION" | "COMMENT" | "DOWNLOAD" | "IMAGE" | "CHANNEL";

type AddArgs = {
  input: {
    collectionId: string;
    itemId: string;
    itemType: CollectionItemType;
    position?: number | null;
  };
};

type RemoveArgs = {
  collectionId: string;
  itemId: string;
  itemType: CollectionItemType;
};

type ReorderArgs = {
  collectionId: string;
  itemId: string;
  newPosition: number;
};

type ItemConfig = {
  label: string;
  relationship: string;
  idProperty: string;
};

const itemConfigs: Record<CollectionItemType, ItemConfig> = {
  DISCUSSION: {
    label: "Discussion",
    relationship: "CONTAINS_DISCUSSION",
    idProperty: "id",
  },
  COMMENT: {
    label: "Comment",
    relationship: "CONTAINS_COMMENT",
    idProperty: "id",
  },
  DOWNLOAD: {
    label: "Discussion",
    relationship: "CONTAINS_DOWNLOAD",
    idProperty: "id",
  },
  IMAGE: {
    label: "Image",
    relationship: "CONTAINS_IMAGE",
    idProperty: "id",
  },
  CHANNEL: {
    label: "Channel",
    relationship: "CONTAINS_CHANNEL",
    idProperty: "uniqueName",
  },
};

const getUsername = (context: GraphQLContext) => {
  const username = context.user?.username;
  if (!username) {
    throw new GraphQLError("You must be logged in to update collections.");
  }
  return username;
};

const getItemConfig = (itemType: CollectionItemType) => {
  const config = itemConfigs[itemType];
  if (!config) {
    throw new GraphQLError("Unsupported collection item type.");
  }
  return config;
};

const getWriteSession = (driver: Driver) =>
  driver.session({ defaultAccessMode: "WRITE" });

export const addToCollection = ({ driver }: { driver: Driver }) => {
  return async (_parent: unknown, args: AddArgs, context: GraphQLContext) => {
    const username = getUsername(context);
    const { collectionId, itemId, itemType, position } = args.input;
    const { label, relationship, idProperty } = getItemConfig(itemType);
    const session = getWriteSession(driver);

    try {
      const result = await session.run(
        `
        MATCH (collection:Collection {id: $collectionId})-[:CREATED_BY]->(:User {username: $username})
        MATCH (item:${label} {${idProperty}: $itemId})
        MERGE (collection)-[:${relationship}]->(item)
        WITH collection, coalesce(collection.itemOrder, []) AS existingOrder
        WITH collection, [id IN existingOrder WHERE id <> $itemId] AS withoutItem
        WITH collection,
          CASE
            WHEN $position IS NULL OR $position < 0 OR $position >= size(withoutItem)
              THEN withoutItem + [$itemId]
            ELSE withoutItem[0..$position] + [$itemId] + withoutItem[$position..]
          END AS nextOrder
        SET collection.itemOrder = nextOrder
        RETURN collection.itemOrder AS itemOrder
        `,
        {
          collectionId,
          itemId,
          position: position ?? null,
          username,
        }
      );

      if (result.records.length === 0) {
        throw new GraphQLError("Collection or item not found, or you do not own this collection.");
      }

      return true;
    } finally {
      await session.close();
    }
  };
};

export const removeFromCollection = ({ driver }: { driver: Driver }) => {
  return async (_parent: unknown, args: RemoveArgs, context: GraphQLContext) => {
    const username = getUsername(context);
    const { collectionId, itemId, itemType } = args;
    const { label, relationship, idProperty } = getItemConfig(itemType);
    const session = getWriteSession(driver);

    try {
      const result = await session.run(
        `
        MATCH (collection:Collection {id: $collectionId})-[:CREATED_BY]->(:User {username: $username})
        OPTIONAL MATCH (collection)-[relationship:${relationship}]->(item:${label} {${idProperty}: $itemId})
        DELETE relationship
        SET collection.itemOrder = [id IN coalesce(collection.itemOrder, []) WHERE id <> $itemId]
        RETURN collection.itemOrder AS itemOrder
        `,
        {
          collectionId,
          itemId,
          username,
        }
      );

      if (result.records.length === 0) {
        throw new GraphQLError("Collection not found, or you do not own this collection.");
      }

      return true;
    } finally {
      await session.close();
    }
  };
};

export const reorderCollectionItem = ({ driver }: { driver: Driver }) => {
  return async (_parent: unknown, args: ReorderArgs, context: GraphQLContext) => {
    const username = getUsername(context);
    const { collectionId, itemId, newPosition } = args;
    const session = getWriteSession(driver);

    try {
      const result = await session.run(
        `
        MATCH (collection:Collection {id: $collectionId})-[:CREATED_BY]->(:User {username: $username})
        OPTIONAL MATCH (collection)-[:CONTAINS_DISCUSSION|CONTAINS_COMMENT|CONTAINS_DOWNLOAD|CONTAINS_IMAGE|CONTAINS_CHANNEL]->(item)
        WITH collection, collect(coalesce(item.id, item.uniqueName)) AS itemIds
        WITH collection, itemIds,
          [id IN coalesce(collection.itemOrder, []) WHERE id IN itemIds] +
          [id IN itemIds WHERE NOT id IN coalesce(collection.itemOrder, [])] AS normalizedOrder
        WITH collection, itemIds, normalizedOrder
        WHERE $itemId IN itemIds
        WITH collection, [id IN normalizedOrder WHERE id <> $itemId] AS withoutItem
        WITH collection, withoutItem,
          CASE
            WHEN $newPosition < 0 THEN 0
            WHEN $newPosition > size(withoutItem) THEN size(withoutItem)
            ELSE $newPosition
          END AS targetPosition
        SET collection.itemOrder = withoutItem[0..targetPosition] + [$itemId] + withoutItem[targetPosition..]
        RETURN collection.itemOrder AS itemOrder
        `,
        {
          collectionId,
          itemId,
          newPosition,
          username,
        }
      );

      if (result.records.length === 0) {
        throw new GraphQLError("Item is not in this collection, or you do not own this collection.");
      }

      return true;
    } finally {
      await session.close();
    }
  };
};
