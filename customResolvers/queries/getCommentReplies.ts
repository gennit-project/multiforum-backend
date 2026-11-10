import {rememberCanonicalSource} from '../../services/canonicalSourceFields.js';
import { canonicalReplyComment } from "../../services/customCommentSources.js";
import type { CommentRepliesRow } from "../contracts/viewerReadProjections.js";
import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import { getCommentRepliesQuery } from "../cypher/cypherQueries.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";

import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import { isSensitiveContentTarget } from "../../services/sensitiveContentTarget.js";
import { logger } from "../../logger.js";
import { getHotRankingQueryParams } from "../../services/rankingSettingsStore.js";
import { normalizePagination } from "../../services/pagination.js";

type Input = {
  driver: Driver;
  agePolicyRepository?: AgePolicyReader;
  serverName?: string;
};

type Args = {
  commentId: string;
  modName?: string | null;
  offset?: string | number | null;
  limit?: string | number | null;
  sort?: string | null;
};

const getResolver = (input: Input) => {
  const { driver, agePolicyRepository, serverName } = input;
  return async (
    _parent: unknown,
    args: Args,
    context: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const { commentId, modName, sort } = args;
    const { offset, limit } = normalizePagination(args);
    context.user = await setUserDataOnContext({
      context,
    });
    const loggedInUsername = context.user?.username || null;

    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver,
      agePolicyRepository,
    });
    if (
      !canViewSensitiveContent &&
      await isSensitiveContentTarget(driver, { commentId })
    ) {
      return rememberCanonicalSource({ ChildComments: [], aggregateChildCommentCount: 0 });
    }

    const session = driver.session();

    try {
      const effectiveSort =
        sort === "top" ? "top" : sort === "hot" ? "hot" : "new";
      const rankingParams = await getHotRankingQueryParams({
        executor: session,
        profile: "comment",
        sortOption: effectiveSort,
        serverName,
      });

      const commentRepliesResult = await session.run<CommentRepliesRow>(getCommentRepliesQuery, {
        commentId,
        modName,
        offset,
        limit,
        sortOption: effectiveSort,
        loggedInUsername,
        ...rankingParams,
      });

      const record = commentRepliesResult.records[0];
      if (!record) {
        return rememberCanonicalSource({
          ChildComments: [],
          aggregateChildCommentCount: 0,
        });
      }

      const aggregateCount = record.get("aggregateChildCommentCount");

      return rememberCanonicalSource({
        ChildComments: (record.get("ChildComments") || []).map(canonicalReplyComment),
        aggregateChildCommentCount: aggregateCount?.toNumber() || 0,
      });
    } catch (error: unknown) {
      logger.error("Error getting comment replies:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch comment replies. ${message}`);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
