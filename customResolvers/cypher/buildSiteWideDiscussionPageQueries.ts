export type SiteWideDiscussionSortOption = "hot" | "new" | "top";

type SiteWideDiscussionPageQueryOptions = {
  hasDownload: boolean | null;
  hasSearch: boolean;
  hasSelectedChannels: boolean;
  hasSelectedTags: boolean;
  showArchived: boolean;
  sortOption: SiteWideDiscussionSortOption;
  paginationMode?: "cursor" | "initial" | "offset";
};

const matchingChannelPredicate = (
  options: SiteWideDiscussionPageQueryOptions
) => {
  const predicates: string[] = [];

  if (!options.showArchived) {
    predicates.push("coalesce(dc.archived, false) = false");
  }
  if (options.hasSelectedChannels) {
    predicates.push("dc.channelUniqueName IN $selectedChannels");
  }

  return predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : "";
};

const discussionPredicates = (
  options: SiteWideDiscussionPageQueryOptions
) => {
  const predicates = [
    "($mayAccessSensitiveContent OR coalesce(d.hasSensitiveContent, false) = false)",
    `EXISTS {
      MATCH (d)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
      ${matchingChannelPredicate(options)}
    }`,
  ];

  if (options.sortOption === "top") {
    predicates.push(
      "datetime(d.createdAt).epochMillis > datetime($startOfTimeFrame).epochMillis"
    );
  }
  if (options.hasSelectedTags) {
    predicates.push(`EXISTS {
      MATCH (d)-[:HAS_TAG]->(tag:Tag)
      WHERE tag.text IN $selectedTags
    }`);
  }
  if (options.hasDownload === true) {
    predicates.push(`d.hasDownload = true
      AND EXISTS { MATCH (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile) }`);
  } else if (options.hasDownload === false) {
    predicates.push("(d.hasDownload = false OR d.hasDownload IS NULL)");
  }

  return predicates.join("\n  AND ");
};

const discussionAnchor = (hasSearch: boolean) =>
  hasSearch
    ? "CALL db.index.fulltext.queryNodes($fulltextIndex, $fulltextQuery) YIELD node AS d"
    : "MATCH (d:Discussion)";

const rankingClause = (
  sortOption: SiteWideDiscussionSortOption,
  channelPredicate: string,
  paginationMode: "cursor" | "initial" | "offset"
) => {
  const offsetClause =
    paginationMode === "offset" ? "SKIP toInteger($offset)" : "";

  if (sortOption === "new") {
    const cursorClause =
      paginationMode === "cursor"
        ? `WHERE d.createdAt < datetime($cursorCreatedAt)
   OR (d.createdAt = datetime($cursorCreatedAt) AND d.id < $cursorDiscussionId)`
        : "";
    return `WITH d
${cursorClause}
ORDER BY d.createdAt DESC, d.id DESC
${offsetClause}
LIMIT toInteger($pageLimit)
RETURN d.id AS discussionId,
       d.createdAt AS cursorCreatedAt,
       null AS cursorScore`;
  }

  if (sortOption === "top") {
    const cursorClause =
      paginationMode === "cursor"
        ? `WHERE score < $cursorScore
   OR (score = $cursorScore AND d.createdAt < datetime($cursorCreatedAt))
   OR (score = $cursorScore AND d.createdAt = datetime($cursorCreatedAt) AND d.id < $cursorDiscussionId)`
        : "";
    return `MATCH (d)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
${channelPredicate}
WITH d, sum(CASE WHEN coalesce(dc.weightedVotesCount, 0.0) < 0 THEN 0.0 ELSE coalesce(dc.weightedVotesCount, 0.0) END) AS score
${cursorClause}
ORDER BY score DESC, d.createdAt DESC, d.id DESC
${offsetClause}
LIMIT toInteger($pageLimit)
RETURN d.id AS discussionId,
       d.createdAt AS cursorCreatedAt,
       score AS cursorScore`;
  }

  const cursorClause =
    paginationMode === "cursor"
      ? `WHERE hotRank < $cursorScore
   OR (hotRank = $cursorScore AND d.createdAt < datetime($cursorCreatedAt))
   OR (hotRank = $cursorScore AND d.createdAt = datetime($cursorCreatedAt) AND d.id < $cursorDiscussionId)`
      : "";
  return `MATCH (d)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
${channelPredicate}
WITH d,
     sum(CASE WHEN coalesce(dc.weightedVotesCount, 0.0) < 0 THEN 0.0 ELSE coalesce(dc.weightedVotesCount, 0.0) END) AS score,
     duration.between(d.createdAt, datetime($rankingAnchor)).months +
       duration.between(d.createdAt, datetime($rankingAnchor)).days / 30.0 AS ageInMonths
WITH d, score, CASE WHEN ageInMonths IS NULL THEN 0 ELSE ageInMonths END AS ageInMonths
WITH d, log10(score + 1) / ((ageInMonths + $hotAgeOffsetMonths) ^ $hotGravity) AS hotRank
${cursorClause}
ORDER BY hotRank DESC, d.createdAt DESC, d.id DESC
${offsetClause}
LIMIT toInteger($pageLimit)
RETURN d.id AS discussionId,
       d.createdAt AS cursorCreatedAt,
       hotRank AS cursorScore`;
};

/**
 * Build fixed query variants so Neo4j only compiles predicates that are active.
 * Counting and page selection deliberately return scalars/IDs; display data is
 * loaded only for the selected page by getSiteWideDiscussionsQuery.
 */
export const buildSiteWideDiscussionPageQueries = (
  options: SiteWideDiscussionPageQueryOptions
) => {
  const predicates = discussionPredicates(options);
  const channelPredicate = matchingChannelPredicate(options);
  const paginationMode = options.paginationMode ?? "initial";

  return {
    countQuery: `${discussionAnchor(options.hasSearch)}
WHERE ${predicates}
RETURN count(d) AS totalCount`,
    pageQuery: `${discussionAnchor(options.hasSearch)}
WHERE ${predicates}
${rankingClause(options.sortOption, channelPredicate, paginationMode)}`,
  };
};
