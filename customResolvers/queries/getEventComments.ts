import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import {
  getEventCommentsMetadataQuery,
  getEventCommentsQuery,
} from "../cypher/cypherQueries.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import { getHotRankingQueryParams } from "../../services/rankingSettingsStore.js";
import { normalizePagination } from "../../services/pagination.js";

type Input = {
  driver: Driver;
  serverName?: string;
};

type Args = {
  eventId: string;
  offset: string;
  limit: string;
  sort: string;
};

const getResolver = (input: Input) => {
  const { driver, serverName } = input;
  return async (
    _parent: unknown,
    args: Args,
    context: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const { eventId, sort } = args;
    const { offset, limit } = normalizePagination(args);
    context.user = await setUserDataOnContext({
      context,
    });
    const loggedInUsername = context.user?.username || null;

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

      return await session.executeWrite(async (transaction) => {
        const eventResult = await transaction.run(
          getEventCommentsMetadataQuery,
          {
            eventId,
            loggedInUsername,
          }
        );
        const event = eventResult.records[0]?.get("Event");
        if (!event) return { Event: null, Comments: [] };

        const commentsResult = await transaction.run(getEventCommentsQuery, {
          eventId,
          offset,
          limit,
          sortOption: effectiveSort,
          loggedInUsername,
          ...rankingParams,
        });

        return {
          Event: event,
          Comments: commentsResult.records.map((record) => record.get("comment")),
        };
      });
    } catch (error: unknown) {
      logger.error("Error getting event comments:", error);
      return {
        Event: null,
        Comments: [],
      };
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
