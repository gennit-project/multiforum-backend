import type { GraphQLResolveInfo } from "graphql";
import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import { getSiteWideDiscussionsQuery } from "../cypher/cypherQueries.js";
import {
  buildSiteWideDiscussionPageQueries,
  type SiteWideDiscussionSortOption,
} from "../cypher/buildSiteWideDiscussionPageQueries.js";
import { timeFrameOptions } from "./utils.js";
import type { GraphQLContext } from "../../types/context.js";
import type { DiscussionModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";
import { getHotRankingQueryParams } from "../../services/rankingSettingsStore.js";
import { mayAccessSensitiveContent as resolveSensitiveContentAccess } from "../../services/sensitiveContentAccess.js";
import type { ServerConfigModel } from "../../ogm_types.js";
import { normalizePagination } from "../../services/pagination.js";

type Input = {
  Discussion: DiscussionModel;
  driver: Driver;
  ServerConfig?: ServerConfigModel;
  serverName?: string;
};

enum timeFrameOptionKeys {
  year = "year",
  month = "month",
  week = "week",
  day = "day",
}

type Args = {
  searchInput: string;
  selectedChannels: string[];
  selectedTags: string[];
  showArchived: boolean;
  hasDownload: boolean | null;
  loggedInUsername?: string;
  options: {
    offset: string;
    limit: string;
    resultsOrder: string;
    sort: string;
    timeFrame: timeFrameOptionKeys;
  };
};

const getResolver = (input: Input) => {
  const { driver, ServerConfig, serverName } = input;

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const {
      searchInput = "",
      selectedChannels = [],
      selectedTags = [],
      showArchived,
      hasDownload,
      loggedInUsername,
      options,
    } = args;
    const { sort, timeFrame } = options || {};
    const { offset, limit } = normalizePagination({
      offset: options?.offset,
      limit: options?.limit,
    });
    const mayAccessSensitiveContent = await resolveSensitiveContentAccess({
      context,
      driver,
      ServerConfig,
    });
    const session = driver.session();

    try {
      const effectiveSort: SiteWideDiscussionSortOption =
        sort === "new" || sort === "top" ? sort : "hot";
      const selectedTimeFrame =
        effectiveSort === "top"
          ? (timeFrameOptions[timeFrame] ?? timeFrameOptions.year).start
          : null;
      const rankingParams = await getHotRankingQueryParams({
        executor: session,
        profile: "discussion",
        sortOption: effectiveSort,
        serverName,
      });
      const { countQuery, pageQuery } = buildSiteWideDiscussionPageQueries({
        hasDownload:
          typeof hasDownload === "boolean" ? hasDownload : null,
        hasSearch: searchInput !== "",
        hasSelectedChannels: selectedChannels.length > 0,
        hasSelectedTags: selectedTags.length > 0,
        showArchived,
        sortOption: effectiveSort,
      });
      const queryParams = {
        searchInput,
        titleRegex: `(?i).*${searchInput}.*`,
        bodyRegex: `(?i).*${searchInput}.*`,
        selectedChannels,
        selectedTags,
        showArchived,
        hasDownload,
        offset,
        limit,
        resultsOrder: options?.resultsOrder,
        sortOption: effectiveSort,
        startOfTimeFrame: selectedTimeFrame,
        loggedInUsername: loggedInUsername || null,
        mayAccessSensitiveContent,
        ...rankingParams,
      };

      // These are read-only queries, but executeWrite intentionally keeps the
      // transaction on the leader. Switching to executeRead would route to an
      // Aura reader and could break read-your-own-writes without bookmarks.
      return await session.executeWrite(async (transaction) => {
        const countResult = await transaction.run(countQuery, queryParams);
        const aggregateDiscussionCount =
          countResult.records[0]?.get("totalCount") ?? 0;

        const pageResult = await transaction.run(pageQuery, queryParams);
        const discussionIds = pageResult.records.map(
          (record: Neo4jRecord) => record.get("discussionId") as string
        );

        if (discussionIds.length === 0) {
          return { discussions: [], aggregateDiscussionCount };
        }

        const discussionsResult = await transaction.run(
          getSiteWideDiscussionsQuery,
          {
            discussionIds,
            selectedChannels,
            showArchived,
            loggedInUsername: loggedInUsername || null,
            mayAccessSensitiveContent,
          }
        );
        const discussions = discussionsResult.records.map(
          (record: Neo4jRecord) => record.get("discussion")
        );

        return { discussions, aggregateDiscussionCount };
      });
    } catch (error: unknown) {
      logger.error("Error getting discussions:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch discussions. ${message}`);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
