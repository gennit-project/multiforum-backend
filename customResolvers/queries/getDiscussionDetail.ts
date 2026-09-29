import type { Driver } from "neo4j-driver";
import type { ServerConfigModel } from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  getDiscussionDetailChannelQuery,
  getDiscussionDetailCoreQuery,
  getDiscussionDetailFilesQuery,
} from "../cypher/cypherQueries.js";

type Input = {
  driver: Driver;
  ServerConfig?: ServerConfigModel;
};

type Args = {
  discussionId: string;
  channelUniqueName: string;
};

type DiscussionDetail = Record<string, unknown> & {
  DiscussionChannels?: unknown[];
  DownloadableFiles?: unknown[];
};

const IMAGE_LIMIT = 12;
const PREVIEW_IMAGE_LIMIT = 12;
const ANSWER_LIMIT = 5;
const FILE_LIMIT = 12;

/**
 * Hydrates the first detail-page view in three bounded, independently planned
 * reads. This avoids the row multiplication produced when GraphQL's generated
 * Cypher joins every one-to-many relationship into one statement.
 */
const getDiscussionDetail = ({ driver, ServerConfig }: Input) => {
  return async (
    _parent: unknown,
    args: Args,
    context: GraphQLContext
  ): Promise<DiscussionDetail[]> => {
    context.user = await setUserDataOnContext({ context });
    const viewerUsername = context.user?.username || null;
    const viewerModName =
      context.user?.data?.ModerationProfile?.displayName || null;
    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver,
      ServerConfig,
    });
    const session = driver.session();
    const sharedParams = {
      discussionId: args.discussionId,
      channelUniqueName: args.channelUniqueName,
      viewerUsername,
      viewerModName,
      mayAccessSensitiveContent: canViewSensitiveContent,
      imageLimit: IMAGE_LIMIT,
      previewImageLimit: PREVIEW_IMAGE_LIMIT,
      answerLimit: ANSWER_LIMIT,
      fileLimit: FILE_LIMIT,
    };

    try {
      // Keep these reads on one leader transaction to preserve the project's
      // read-your-own-writes behavior until request bookmarks are propagated.
      return await session.executeWrite(async (transaction) => {
        const coreResult = await transaction.run(
          getDiscussionDetailCoreQuery,
          sharedParams
        );
        const discussion = coreResult.records[0]?.get("Discussion") as
          | DiscussionDetail
          | undefined;
        if (!discussion) return [];

        const channelResult = await transaction.run(
          getDiscussionDetailChannelQuery,
          sharedParams
        );
        const discussionChannel =
          channelResult.records[0]?.get("DiscussionChannel");
        if (!discussionChannel) return [];

        const filesResult = await transaction.run(
          getDiscussionDetailFilesQuery,
          sharedParams
        );
        const downloadableFiles =
          filesResult.records[0]?.get("DownloadableFiles") || [];
        const detailFilesHasNextPage =
          filesResult.records[0]?.get("detailFilesHasNextPage") === true;

        return [
          {
            ...discussion,
            DiscussionChannels: [discussionChannel],
            DownloadableFiles: downloadableFiles,
            _detailFilesHasNextPage: detailFilesHasNextPage,
          },
        ];
      });
    } finally {
      await session.close();
    }
  };
};

export default getDiscussionDetail;
