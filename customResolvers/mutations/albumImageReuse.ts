import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import { ERROR_MESSAGES } from "../../rules/errorMessages.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";

type AddArgs = {
  albumId: string;
  imageId: string;
  position?: number | null;
};

type RemoveArgs = {
  albumId: string;
  imageId: string;
};

const getUsername = async (context: GraphQLContext) => {
  context.user = await setUserDataOnContext({ context });
  const username = context.user?.username;

  if (!username) {
    throw new GraphQLError("You must be logged in to update albums.");
  }

  return username;
};

const validateIds = ({ albumId, imageId }: RemoveArgs) => {
  if (!albumId) {
    throw new GraphQLError(ERROR_MESSAGES.album.noId);
  }

  if (!imageId) {
    throw new GraphQLError(ERROR_MESSAGES.image.noId);
  }
};

const getWriteSession = (driver: Driver) =>
  driver.session({ defaultAccessMode: "WRITE" });

export const addImageToAlbum = ({ driver }: { driver: Driver }) => {
  return async (_parent: unknown, args: AddArgs, context: GraphQLContext) => {
    validateIds(args);
    const username = await getUsername(context);
    const session = getWriteSession(driver);

    try {
      const result = await session.run(
        `
        OPTIONAL MATCH (album:Album { id: $albumId })
        OPTIONAL MATCH (owner:User { username: $username })-[:HAS_ALBUM]->(album)
        OPTIONAL MATCH (image:Image { id: $imageId })
        WITH album, owner, image
        OPTIONAL MATCH (album)-[existing:HAS_IMAGE]->(image)
        WITH album, owner, image, existing,
          CASE
            WHEN album IS NULL THEN "ALBUM_NOT_FOUND"
            WHEN owner IS NULL THEN "NOT_OWNER"
            WHEN image IS NULL
              OR coalesce(image.archived, false) = true
              OR coalesce(image.permanentlyRemoved, false) = true
              THEN "IMAGE_NOT_FOUND"
            WHEN existing IS NOT NULL THEN "ALREADY_IN_ALBUM"
            ELSE "OK"
          END AS status
        FOREACH (_ IN CASE WHEN status = "OK" THEN [1] ELSE [] END |
          MERGE (album)-[:HAS_IMAGE]->(image)
        )
        WITH album, image, status,
          [id IN coalesce(album.imageOrder, []) WHERE id <> $imageId] AS withoutImage
        WITH album, image, status, withoutImage,
          CASE
            WHEN status <> "OK" THEN coalesce(album.imageOrder, [])
            WHEN $position IS NULL OR $position < 0 OR $position >= size(withoutImage)
              THEN withoutImage + [$imageId]
            ELSE withoutImage[0..$position] + [$imageId] + withoutImage[$position..]
          END AS nextOrder
        FOREACH (_ IN CASE WHEN status = "OK" THEN [1] ELSE [] END |
          SET album.imageOrder = nextOrder
        )
        RETURN status
        `,
        {
          albumId: args.albumId,
          imageId: args.imageId,
          position: args.position ?? null,
          username,
        }
      );

      const status = result.records[0]?.get("status");

      if (status === "OK") {
        return true;
      }

      if (status === "ALBUM_NOT_FOUND") {
        throw new GraphQLError(ERROR_MESSAGES.album.notFound);
      }

      if (status === "NOT_OWNER") {
        throw new GraphQLError(ERROR_MESSAGES.album.notOwner);
      }

      if (status === "IMAGE_NOT_FOUND") {
        throw new GraphQLError(ERROR_MESSAGES.image.notFound);
      }

      if (status === "ALREADY_IN_ALBUM") {
        throw new GraphQLError("Image is already in this album.");
      }

      throw new GraphQLError("Could not add image to album.");
    } finally {
      await session.close();
    }
  };
};

export const removeImageFromAlbum = ({ driver }: { driver: Driver }) => {
  return async (_parent: unknown, args: RemoveArgs, context: GraphQLContext) => {
    validateIds(args);
    const username = await getUsername(context);
    const session = getWriteSession(driver);

    try {
      const result = await session.run(
        `
        OPTIONAL MATCH (album:Album { id: $albumId })
        OPTIONAL MATCH (owner:User { username: $username })-[:HAS_ALBUM]->(album)
        WITH album, owner
        OPTIONAL MATCH (album)-[relationship:HAS_IMAGE]->(:Image { id: $imageId })
        WITH album, owner, relationship,
          CASE
            WHEN album IS NULL THEN "ALBUM_NOT_FOUND"
            WHEN owner IS NULL THEN "NOT_OWNER"
            ELSE "OK"
          END AS status
        FOREACH (_ IN CASE WHEN status = "OK" AND relationship IS NOT NULL THEN [1] ELSE [] END |
          DELETE relationship
        )
        FOREACH (_ IN CASE WHEN status = "OK" THEN [1] ELSE [] END |
          SET album.imageOrder = [id IN coalesce(album.imageOrder, []) WHERE id <> $imageId]
        )
        RETURN status
        `,
        {
          albumId: args.albumId,
          imageId: args.imageId,
          username,
        }
      );

      const status = result.records[0]?.get("status");

      if (status === "OK") {
        return true;
      }

      if (status === "ALBUM_NOT_FOUND") {
        throw new GraphQLError(ERROR_MESSAGES.album.notFound);
      }

      if (status === "NOT_OWNER") {
        throw new GraphQLError(ERROR_MESSAGES.album.notOwner);
      }

      throw new GraphQLError("Could not remove image from album.");
    } finally {
      await session.close();
    }
  };
};
