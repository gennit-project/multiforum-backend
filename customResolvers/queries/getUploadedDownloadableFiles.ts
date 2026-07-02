import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

type GetUploadedDownloadableFilesInput = {
  driver: Driver;
};

type Args = {
  username: string;
};

type UploadedDownloadableFileRecord = {
  discussion: {
    id: string;
    title: string;
    createdAt?: string | null;
    updatedAt?: string | null;
    channelUniqueNames: string[];
  };
  files: Array<Record<string, unknown>>;
};

const getUploadedDownloadableFiles = ({
  driver,
}: GetUploadedDownloadableFilesInput) => {
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext
  ): Promise<UploadedDownloadableFileRecord[]> => {
    if (!context.user?.username) {
      context.user = await setUserDataOnContext({ context });
    }

    if (!context.user?.username) {
      throw new GraphQLError("User must be logged in");
    }

    if (context.user.username !== args.username) {
      throw new GraphQLError("Not authorized to view uploaded downloadable files");
    }

    const session = driver.session({ defaultAccessMode: "READ" });

    try {
      const result = await session.run(
        `
        MATCH (discussion:Discussion)-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile)
        WHERE file.uploadedByUsername = $username
          AND coalesce(file.permanentlyRemoved, false) = false
        OPTIONAL MATCH (discussion)-[:POSTED_IN_CHANNEL]->(discussionChannel:DiscussionChannel)
        WITH discussion, file, collect(DISTINCT discussionChannel.channelUniqueName) AS channelUniqueNames
        ORDER BY coalesce(file.createdAt, file.uploadedAt) DESC, file.fileName ASC
        WITH discussion, channelUniqueNames, collect(file {
          .*,
          createdAt: toString(file.createdAt),
          uploadedAt: toString(file.uploadedAt),
          permanentlyRemovedAt: toString(file.permanentlyRemovedAt)
        }) AS files
        ORDER BY coalesce(discussion.updatedAt, discussion.createdAt) DESC, discussion.title ASC
        RETURN {
          discussion: {
            id: discussion.id,
            title: discussion.title,
            createdAt: toString(discussion.createdAt),
            updatedAt: toString(discussion.updatedAt),
            channelUniqueNames: channelUniqueNames
          },
          files: files
        } AS group
        `,
        { username: args.username }
      );

      return result.records.map((record) => record.get("group"));
    } finally {
      await session.close();
    }
  };
};

export default getUploadedDownloadableFiles;
