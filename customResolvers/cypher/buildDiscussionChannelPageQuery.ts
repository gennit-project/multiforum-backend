export type DiscussionChannelSortOption = "hot" | "new" | "top";

type DiscussionChannelPageQueryOptions = {
  hasDownload: boolean | null;
  hasLabelFilters: boolean;
  hasSearch: boolean;
  hasSelectedTags: boolean;
  showArchived: boolean;
  showUnanswered: boolean;
  sortOption: DiscussionChannelSortOption;
};

const downloadPredicate = (hasDownload: boolean | null) => {
  if (hasDownload === true) {
    return `discussion.hasDownload = true
      AND EXISTS { MATCH (discussion)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile) }`;
  }
  if (hasDownload === false) {
    return "(discussion.hasDownload = false OR discussion.hasDownload IS NULL)";
  }
  return null;
};

const labelFilterPredicate = `ALL(labelFilter IN $labelFilters WHERE
      EXISTS {
        MATCH (:Channel {uniqueName: dc.channelUniqueName})-[:HAS_FILTER_GROUP]->(fg:FilterGroup {key: labelFilter.groupKey})
        WHERE CASE
          WHEN fg.mode = "EXCLUDE" THEN NOT EXISTS {
            MATCH (dc)-[:HAS_LABEL_OPTION]->(excludedOption:FilterOption)<-[:HAS_FILTER_OPTION]-(fg)
            WHERE excludedOption.value IN labelFilter.values
          }
          ELSE EXISTS {
            MATCH (dc)-[:HAS_LABEL_OPTION]->(includedOption:FilterOption)<-[:HAS_FILTER_OPTION]-(fg)
            WHERE includedOption.value IN labelFilter.values
          }
        END
      }
    )`;

const rankingClause = (sortOption: DiscussionChannelSortOption) => {
  if (sortOption === "new") {
    return "ORDER BY dc.createdAt DESC";
  }
  if (sortOption === "top") {
    return `WITH dc,
     CASE WHEN coalesce(dc.weightedVotesCount, 0.0) < 0 THEN 0.0 ELSE coalesce(dc.weightedVotesCount, 0.0) END AS weightedVotesCount
ORDER BY weightedVotesCount DESC, dc.createdAt DESC`;
  }
  return `WITH dc,
     CASE WHEN coalesce(dc.weightedVotesCount, 0.0) < 0 THEN 0.0 ELSE coalesce(dc.weightedVotesCount, 0.0) END AS weightedVotesCount,
     duration.between(dc.createdAt, datetime()).months +
     duration.between(dc.createdAt, datetime()).days / 30.0 AS ageInMonths
WITH dc,
     log10(weightedVotesCount + 1) / ((ageInMonths + $hotAgeOffsetMonths) ^ $hotGravity) AS hotRank
ORDER BY hotRank DESC, dc.createdAt DESC`;
};

/**
 * Build one of a bounded set of page-selection queries from fixed fragments.
 * User-provided values remain parameters; only filter presence selects text.
 * This prevents Neo4j from compiling every inactive branch on routine loads.
 */
export const buildDiscussionChannelPageQuery = (
  options: DiscussionChannelPageQueryOptions
) => {
  const predicates = [
    "($mayAccessSensitiveContent OR coalesce(discussion.hasSensitiveContent, false) = false)",
  ];

  if (options.sortOption === "top") {
    predicates.push(
      "($startOfTimeFrame IS NULL OR datetime(dc.createdAt).epochMillis > datetime($startOfTimeFrame).epochMillis)"
    );
  }
  if (options.hasSelectedTags) {
    predicates.push(`EXISTS {
      MATCH (discussion)-[:HAS_TAG]->(tag:Tag)
      WHERE tag.text IN $selectedTags
    }`);
  }
  if (!options.showArchived) {
    predicates.push("coalesce(dc.archived, false) = false");
  }
  if (options.showUnanswered) {
    predicates.push("coalesce(dc.answered, false) = false");
  }

  const selectedDownloadPredicate = downloadPredicate(options.hasDownload);
  if (selectedDownloadPredicate) {
    predicates.push(selectedDownloadPredicate);
  }
  if (options.hasLabelFilters) {
    predicates.push(labelFilterPredicate);
  }

  const anchor = options.hasSearch
    ? `CALL db.index.fulltext.queryNodes($fulltextIndex, $fulltextQuery) YIELD node AS discussion
MATCH (discussion)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel {channelUniqueName: $channelUniqueName})`
    : "MATCH (dc:DiscussionChannel {channelUniqueName: $channelUniqueName})-[:POSTED_IN_CHANNEL]->(discussion:Discussion)";

  return `// Select/count only IDs here; the hydration query loads display data.
${anchor}
WHERE ${predicates.join("\n  AND ")}
WITH DISTINCT dc
${rankingClause(options.sortOption)}
WITH collect(dc.id) AS orderedDiscussionChannelIds
RETURN size(orderedDiscussionChannelIds) AS totalCount,
       orderedDiscussionChannelIds[
         toInteger($offset)..toInteger($offset) + toInteger($limit)
       ] AS discussionChannelIds`;
};
