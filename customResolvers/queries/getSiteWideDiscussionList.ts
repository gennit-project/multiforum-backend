import { canonicalSiteWideDiscussion } from "../../services/canonicalSiteWideDiscussion.js";
import type { SiteWideDiscussionSource } from "../contracts/siteWideDiscussionSources.js";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import neo4j from "neo4j-driver";
import { getSiteWideDiscussionsQuery } from "../cypher/cypherQueries.js";
import {
  buildSiteWideDiscussionPageQueries,
  type SiteWideDiscussionSortOption,
} from "../cypher/buildSiteWideDiscussionPageQueries.js";
import { timeFrameOptions } from "./utils.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import { getHotRankingQueryParams } from "../../services/rankingSettingsStore.js";
import { mayAccessSensitiveContent as resolveSensitiveContentAccess } from "../../services/sensitiveContentAccess.js";
import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";
import { normalizePagination } from "../../services/pagination.js";
import { buildFulltextQuery } from "../../services/channelFulltext.js";
import { DISCUSSION_FULLTEXT_INDEX } from "../../services/contentFulltext.js";
import {
  decodeDiscussionListCursor,
  encodeDiscussionListCursor,
} from "../../services/discussionListCursor.js";

// Missing keys intentionally fall back to the year window.
const timeFrameTable: Record<string, { start: string | null } | undefined> = timeFrameOptions;

type Input = {
  driver: Driver;
  agePolicyRepository?: AgePolicyReader;
  serverName?: string;
};

// Accept the schema's nullable inputs while retaining legacy direct-call
// string pagination and resultsOrder. Explicit null search/lists retain their
// existing TypeError paths below; this migration does not normalize them.
type Args = {
  searchInput?: string | null;
  selectedChannels?: Array<string | null> | null;
  selectedTags?: Array<string | null> | null;
  showArchived?: boolean | null;
  hasDownload?: boolean | null;
  loggedInUsername?: string | null;
  options?: {
    offset?: string | number | null;
    after?: string | null;
    limit?: string | number | null;
    resultsOrder?: string | null;
    sort?: string | null;
    timeFrame?: string | null;
  } | null;
};

const getResolver = (input: Input) => {
  const { driver, agePolicyRepository, serverName } = input;

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
      agePolicyRepository,
    });
    const session = driver.session({
      defaultAccessMode: neo4j.session.READ,
    });

    try {
      // Preserve the existing explicit-null failure at the original trim call,
      // rather than silently treating a schema-valid null as an empty search.
      if (searchInput === null) {
        throw new TypeError("Cannot read properties of null (reading 'trim')");
      }
      const fulltextQuery = buildFulltextQuery(searchInput);
      const effectiveSort: SiteWideDiscussionSortOption =
        sort === "new" || sort === "top" ? sort : "hot";
      const cursor = decodeDiscussionListCursor({
        after: options?.after,
        expectedSort: effectiveSort,
      });
      const computedTimeFrame =
        effectiveSort === "top"
          ? ((timeFrame == null ? undefined : timeFrameTable[timeFrame]) ?? timeFrameOptions.year).start
          : null;
      const rankingAnchor =
        cursor?.rankingAnchor ??
        (effectiveSort === "hot"
          ? new Date().toISOString()
          : computedTimeFrame);
      const paginationMode = cursor
        ? "cursor"
        : offset > 0
          ? "offset"
          : "initial";
      const rankingParams = await getHotRankingQueryParams({
        executor: session,
        profile: "discussion",
        sortOption: effectiveSort,
        serverName,
      });
      // These were previously .length accesses. Keep their null failure after
      // ranking reads and before query construction, including the same message.
      if (selectedChannels === null || selectedTags === null) {
        throw new TypeError("Cannot read properties of null (reading 'length')");
      }
      const { countQuery, pageQuery } = buildSiteWideDiscussionPageQueries({
        hasDownload:
          typeof hasDownload === "boolean" ? hasDownload : null,
        hasSearch: fulltextQuery !== "",
        hasSelectedChannels: selectedChannels.length > 0,
        hasSelectedTags: selectedTags.length > 0,
        showArchived: Boolean(showArchived),
        sortOption: effectiveSort,
        paginationMode,
      });
      const queryParams = {
        fulltextIndex: DISCUSSION_FULLTEXT_INDEX,
        fulltextQuery,
        selectedChannels,
        selectedTags,
        showArchived,
        hasDownload,
        offset,
        limit,
        pageLimit: limit + 1,
        cursorCreatedAt: cursor?.createdAt ?? null,
        cursorDiscussionId: cursor?.discussionId ?? null,
        cursorScore: cursor?.sortValue ?? null,
        rankingAnchor,
        resultsOrder: options?.resultsOrder,
        sortOption: effectiveSort,
        startOfTimeFrame:
          effectiveSort === "top" ? rankingAnchor : computedTimeFrame,
        loggedInUsername: loggedInUsername || null,
        mayAccessSensitiveContent,
        ...rankingParams,
      };

      return await session.executeRead(async (transaction) => {
        const countResult = await transaction.run(countQuery, queryParams);
        const aggregateDiscussionCount =
          countResult.records[0]?.get("totalCount") ?? 0;

        const pageResult = await transaction.run(pageQuery, queryParams);
        const hasNextPage = pageResult.records.length > limit;
        const selectedRecords = pageResult.records.slice(0, limit);
        const discussionIds = selectedRecords.map(
          (record: Neo4jRecord) => record.get("discussionId") as string
        );
        const lastRecord = selectedRecords[selectedRecords.length - 1];
        const cursorScore = lastRecord?.get("cursorScore");
        const normalizedCursorScore =
          cursorScore === null || cursorScore === undefined
            ? null
            : typeof cursorScore === "number"
              ? cursorScore
              : Number(cursorScore.toString());
        const endCursor = lastRecord
          ? encodeDiscussionListCursor({
              sort: effectiveSort,
              sortValue: normalizedCursorScore,
              createdAt: lastRecord.get("cursorCreatedAt").toString(),
              discussionId: lastRecord.get("discussionId") as string,
              rankingAnchor,
            })
          : null;
        const pageInfo = { endCursor, hasNextPage };

        if (discussionIds.length === 0) {
          return { discussions: [], aggregateDiscussionCount, pageInfo };
        }

        const discussionsResult = await transaction.run<{discussion:SiteWideDiscussionSource}>(
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
          (record) => canonicalSiteWideDiscussion(record.get("discussion"))
        );

        return { discussions, aggregateDiscussionCount, pageInfo };
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
