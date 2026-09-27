import type { GraphQLResolveInfo } from "graphql";
import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { getDiscussionChannelsQuery } from "../cypher/cypherQueries.js";
import {
  buildDiscussionChannelPageQuery,
  type DiscussionChannelSortOption,
} from "../cypher/buildDiscussionChannelPageQuery.js";
import { timeFrameOptions } from "./utils.js";
import type { GraphQLContext } from "../../types/context.js";
import type { DiscussionChannelModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";
import { getHotRankingQueryParams } from "../../services/rankingSettingsStore.js";
import { mayAccessSensitiveContent as resolveSensitiveContentAccess } from "../../services/sensitiveContentAccess.js";
import type { ServerConfigModel } from "../../ogm_types.js";
import { normalizePagination } from "../../services/pagination.js";

enum timeFrameOptionKeys {
  year = "year",
  month = "month",
  week = "week",
  day = "day",
}

type Input = {
  DiscussionChannel: DiscussionChannelModel;
  driver: Driver;
  ServerConfig?: ServerConfigModel;
  serverName?: string;
};

type LabelFilter = {
  groupKey: string;
  values: string[];
};

type Args = {
  channelUniqueName: string;
  options: {
    offset: string;
    limit: string;
    sort: string;
    timeFrame: timeFrameOptionKeys;
  };
  selectedTags: string[];
  searchInput: string;
  showArchived: boolean;
  showUnanswered?: boolean;
  hasDownload?: boolean | null;
  labelFilters: LabelFilter[];
};

const getResolver = (input: Input) => {
  const { driver, ServerConfig, serverName } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { channelUniqueName, options, selectedTags, searchInput, showArchived, showUnanswered, hasDownload, labelFilters } = args;
    const { sort, timeFrame } = options || {};
    const { offset, limit } = normalizePagination({
      offset: options?.offset,
      limit: options?.limit,
    });
    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
    });
  
    const loggedInUsername = context.user?.username || null;
    const hasDownloadFilter = typeof hasDownload === "boolean" ? hasDownload : null;
    const mayAccessSensitiveContent = await resolveSensitiveContentAccess({
      context,
      driver,
      ServerConfig,
    });
    const searchValue = searchInput ?? "";

    const session = driver.session();
    const titleRegex = `(?i).*${searchValue}.*`;
    const bodyRegex = `(?i).*${searchValue}.*`;

    try {
      const effectiveSort: DiscussionChannelSortOption =
        sort === "new" || sort === "top" ? sort : "hot";
      const normalizedSelectedTags = selectedTags || [];
      const normalizedLabelFilters = labelFilters || [];
      const selectedTimeFrame =
        effectiveSort === "top" && timeFrameOptions[timeFrame]
          ? timeFrameOptions[timeFrame].start
          : null;
      const rankingParams = await getHotRankingQueryParams({
        executor: session,
        profile: "discussion",
        sortOption: effectiveSort,
        serverName,
      });
      const pageQuery = buildDiscussionChannelPageQuery({
        hasDownload: hasDownloadFilter,
        hasLabelFilters: normalizedLabelFilters.length > 0,
        hasSearch: searchValue !== "",
        hasSelectedTags: normalizedSelectedTags.length > 0,
        showArchived,
        showUnanswered: showUnanswered ?? false,
        sortOption: effectiveSort,
      });
      const pageQueryParams: Record<string, unknown> = {
        channelUniqueName,
        offset,
        limit,
        mayAccessSensitiveContent,
      };
      if (searchValue !== "") {
        pageQueryParams.titleRegex = titleRegex;
        pageQueryParams.bodyRegex = bodyRegex;
      }
      if (normalizedSelectedTags.length > 0) {
        pageQueryParams.selectedTags = normalizedSelectedTags;
      }
      if (normalizedLabelFilters.length > 0) {
        pageQueryParams.labelFilters = normalizedLabelFilters;
      }
      if (effectiveSort === "top") {
        pageQueryParams.startOfTimeFrame = selectedTimeFrame;
      }
      if (effectiveSort === "hot") {
        Object.assign(pageQueryParams, rankingParams);
      }

      // These are read-only queries, but executeWrite intentionally keeps the
      // transaction on the leader. Switching to executeRead would route to an
      // Aura reader and could break read-your-own-writes without bookmarks.
      return await session.executeWrite(async (transaction) => {
        const pageResult = await transaction.run(
          pageQuery,
          pageQueryParams
        );
        const pageRecord = pageResult.records[0];
        const aggregateCount = pageRecord?.get("totalCount") ?? 0;
        const discussionChannelIds = (pageRecord?.get(
          "discussionChannelIds"
        ) ?? []) as string[];

        if (discussionChannelIds.length === 0) {
          return {
            discussionChannels: [],
            aggregateDiscussionChannelsCount: aggregateCount,
          };
        }

        const discussionChannelsResult = await transaction.run(
          getDiscussionChannelsQuery,
          {
            discussionChannelIds,
            loggedInUsername,
            mayAccessSensitiveContent,
          }
        );
        const discussionChannels = discussionChannelsResult.records.map(
          (record: Neo4jRecord) => record.get("DiscussionChannel")
        );

        return {
          discussionChannels,
          aggregateDiscussionChannelsCount: aggregateCount,
        };
      });
    } catch (error: unknown) {
      logger.error("Error getting discussionChannels:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to fetch discussionChannels in channel. ${message}`
      );
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
