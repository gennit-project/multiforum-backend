import type { GraphQLResolveInfo } from 'graphql'
import type { Driver } from 'neo4j-driver'
import {
  getCommentSectionChannelQuery,
  getCommentsQuery,
} from '../cypher/cypherQueries.js'
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";
import type { ServerConfigModel } from "../../ogm_types.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import { isSensitiveContentTarget } from "../../services/sensitiveContentTarget.js";
import { logger } from "../../logger.js";
import { getHotRankingQueryParams } from "../../services/rankingSettingsStore.js";
import { normalizePagination } from "../../services/pagination.js";

type Input = {
  driver: Driver
  ServerConfig?: ServerConfigModel
  serverName?: string
}

const ANSWER_LIMIT = 20

type Args = {
  channelUniqueName: string
  discussionId: string
  modName: string
  offset: string
  limit: string
  sort: string
}

const getResolver = (input: Input) => {
  const { driver, ServerConfig, serverName } = input
  return async (_parent: unknown, args: Args, context: GraphQLContext, _info: GraphQLResolveInfo) => {
    const { channelUniqueName, discussionId, modName, sort } =
      args
    const { offset, limit } = normalizePagination(args)
    context.user = await setUserDataOnContext({
      context,
    });
    const loggedInUsername = context.user?.username || null;

    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver,
      ServerConfig,
    });
    if (
      !canViewSensitiveContent &&
      await isSensitiveContentTarget(driver, { discussionId })
    ) {
      return { DiscussionChannel: null, Comments: [] };
    }

    const session = driver.session()

    try {
      const effectiveSort = sort === 'top' ? 'top' : sort === 'new' ? 'new' : 'hot'
      const rankingParams = await getHotRankingQueryParams({
        executor: session,
        profile: "comment",
        sortOption: effectiveSort,
        serverName,
      })

      // Keep metadata and page hydration on one leader transaction. The root
      // comment query selects the page before expanding votes, versions, or
      // replies, so the amount of hydration work is bounded by `limit`.
      return await session.executeWrite(async (transaction) => {
        const channelResult = await transaction.run(
          getCommentSectionChannelQuery,
          {
            discussionId,
            channelUniqueName,
            loggedInUsername,
            answerLimit: ANSWER_LIMIT,
          }
        )
        const discussionChannel = channelResult.records[0]?.get('DiscussionChannel')

        if (!discussionChannel) {
          return { DiscussionChannel: null, Comments: [] }
        }

        const queryResult = await transaction.run(getCommentsQuery, {
          discussionChannelId: discussionChannel.id,
          modName,
          offset,
          limit,
          sortOption: effectiveSort,
          loggedInUsername,
          ...rankingParams,
        })

        return {
          DiscussionChannel: discussionChannel,
          Comments: queryResult.records.map((record) => record.get('comment')),
        }
      })
    } catch (error: unknown) {
      logger.error('Error getting comment section:', error)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to fetch comment section. ${message}`)
    } finally {
      await session.close()
    }
  }
}

export default getResolver
