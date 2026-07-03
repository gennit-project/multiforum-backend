import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";

type Input = {
  driver: Driver;
};

type Args = {
  imageId: string;
};

type AlbumUsage = {
  imageId: string;
  uploaderUsername: string | null;
  uploaderOwnedAlbums: Array<Record<string, unknown>>;
  otherAlbums: Array<Record<string, unknown>>;
};

const getImageAlbumUsage = ({ driver }: Input) => {
  return async (
    _parent: unknown,
    args: Args
  ): Promise<AlbumUsage> => {
    if (!args.imageId) {
      throw new GraphQLError("You must provide an image id.");
    }

    const session = driver.session({ defaultAccessMode: "READ" });

    try {
      const result = await session.run(
        `
        MATCH (image:Image { id: $imageId })
        WHERE coalesce(image.archived, false) = false
          AND coalesce(image.permanentlyRemoved, false) = false
        OPTIONAL MATCH (uploader:User)-[:UPLOADED_IMAGE]->(image)
        OPTIONAL MATCH (album:Album)-[:HAS_IMAGE]->(image)
        OPTIONAL MATCH (owner:User)-[:HAS_ALBUM]->(album)
        OPTIONAL MATCH (album)<-[:HAS_ALBUM]-(discussion:Discussion)
        OPTIONAL MATCH (author:User)-[:POSTED_DISCUSSION]->(discussion)
        OPTIONAL MATCH (discussion)-[:POSTED_IN_CHANNEL]->(discussionChannel:DiscussionChannel)
        WITH image, uploader, album, owner, discussion, author,
          collect(DISTINCT discussionChannel {
            .id,
            .channelUniqueName
          }) AS discussionChannels
        WITH image, uploader, album, owner,
          collect(DISTINCT CASE
            WHEN discussion IS NULL THEN null
            ELSE discussion {
              .id,
              .title,
              createdAt: toString(discussion.createdAt),
              Author: author { .username, .displayName },
              DiscussionChannels: discussionChannels
            }
          END) AS discussions
        WITH image, uploader,
          collect(DISTINCT CASE
            WHEN album IS NULL THEN null
            ELSE album {
              .id,
              imageOrder: album.imageOrder,
              Owner: owner { .username, .displayName },
              Discussions: [discussion IN discussions WHERE discussion IS NOT NULL]
            }
          END) AS albums
        WITH image, uploader, [album IN albums WHERE album IS NOT NULL] AS albums
        RETURN {
          imageId: image.id,
          uploaderUsername: uploader.username,
          uploaderOwnedAlbums: [
            album IN albums
            WHERE album.Owner.username = uploader.username
          ],
          otherAlbums: [
            album IN albums
            WHERE album.Owner.username <> uploader.username
              OR uploader.username IS NULL
              OR album.Owner.username IS NULL
          ]
        } AS usage
        `,
        { imageId: args.imageId }
      );

      const usage = result.records[0]?.get("usage") as AlbumUsage | undefined;

      if (!usage) {
        throw new GraphQLError("Image not found.");
      }

      return usage;
    } finally {
      await session.close();
    }
  };
};

export default getImageAlbumUsage;
