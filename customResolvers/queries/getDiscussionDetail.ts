import {canonicalDiscussionDetail} from "../../services/canonicalDiscussionDetail.js";
import type {DetailFile} from "../contracts/discussionDetailSources.js";
import type { DiscussionViewerCore, DiscussionViewerChannel, DiscussionViewerDetail } from "../contracts/viewerReadProjections.js";
import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";
import type { Driver } from "neo4j-driver";
import neo4j from "neo4j-driver";

import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { resolveDiscussionIdArg } from "../../services/discussionRouteLookup.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  getDiscussionDetailChannelQuery,
  getDiscussionDetailCoreQuery,
  getDiscussionDetailFilesQuery,
} from "../cypher/cypherQueries.js";

type Input = {
  driver: Driver;
  agePolicyRepository?: AgePolicyReader;
};

type Args = {
  // Supply discussionId (global) or discussionNumber (per-forum short URL id).
  discussionId?: string | null;
  discussionNumber?: number | null;
  channelUniqueName: string;
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
const getDiscussionDetail = ({ driver, agePolicyRepository }: Input) => {
  return async (
    _parent: unknown,
    args: Args,
    context: GraphQLContext
  ): Promise<DiscussionViewerDetail[]> => {
    context.user = await setUserDataOnContext({ context });
    const viewerUsername = context.user?.username || null;
    const viewerModName =
      context.user?.data?.ModerationProfile?.displayName || null;
    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver,
      agePolicyRepository,
    });
    const session = driver.session({
      defaultAccessMode: neo4j.session.READ,
    });
    const sharedParams = {
      discussionId: args.discussionId ?? null,
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
      return await session.executeRead(async (transaction) => {
        // Accept either the global discussionId or the per-forum discussionNumber
        // (the short URL id); translate the number to an id up front so every
        // downstream query keeps keying on $discussionId unchanged.
        const resolvedDiscussionId = await resolveDiscussionIdArg(transaction, {
          channelUniqueName: args.channelUniqueName,
          discussionId: args.discussionId,
          discussionNumber: args.discussionNumber,
        });
        if (!resolvedDiscussionId) return [];
        const params = { ...sharedParams, discussionId: resolvedDiscussionId };

        const coreResult = await transaction.run<{Discussion: DiscussionViewerCore}>(
          getDiscussionDetailCoreQuery,
          params
        );
        const discussion = coreResult.records[0]?.get("Discussion");
        if (!discussion) return [];

        const channelResult = await transaction.run<{DiscussionChannel: DiscussionViewerChannel}>(
          getDiscussionDetailChannelQuery,
          params
        );
        const discussionChannel =
          channelResult.records[0]?.get("DiscussionChannel");
        if (!discussionChannel) return [];

        const filesResult = await transaction.run<{DownloadableFiles: DetailFile[]; detailFilesHasNextPage: boolean}>(
          getDiscussionDetailFilesQuery,
          params
        );
        const downloadableFiles =
          filesResult.records[0]?.get("DownloadableFiles") || [];
        const detailFilesHasNextPage =
          filesResult.records[0]?.get("detailFilesHasNextPage") === true;

        return [
          canonicalDiscussionDetail({
            ...discussion,
            DiscussionChannels: [discussionChannel],
            DownloadableFiles: downloadableFiles,
            _detailFilesHasNextPage: detailFilesHasNextPage,
          }),
        ];
      });
    } finally {
      await session.close();
    }
  };
};

export default getDiscussionDetail;
