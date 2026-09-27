export type SiteWideDiscussionSortOption = "hot" | "new" | "top";

type SiteWideDiscussionPageQueryOptions = {
  hasDownload: boolean | null;
  hasSearch: boolean;
  hasSelectedChannels: boolean;
  hasSelectedTags: boolean;
  showArchived: boolean;
  sortOption: SiteWideDiscussionSortOption;
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
  if (options.hasSearch) {
    predicates.push("(d.title =~ $titleRegex OR d.body =~ $bodyRegex)");
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

const rankingClause = (
  sortOption: SiteWideDiscussionSortOption,
  channelPredicate: string
) => {
  if (sortOption === "new") {
    return "ORDER BY d.createdAt DESC";
  }

  if (sortOption === "top") {
    return `MATCH (d)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
${channelPredicate}
WITH d, sum(CASE WHEN coalesce(dc.weightedVotesCount, 0.0) < 0 THEN 0.0 ELSE coalesce(dc.weightedVotesCount, 0.0) END) AS score
ORDER BY score DESC, d.createdAt DESC`;
  }

  return `MATCH (d)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
${channelPredicate}
WITH d,
     sum(CASE WHEN coalesce(dc.weightedVotesCount, 0.0) < 0 THEN 0.0 ELSE coalesce(dc.weightedVotesCount, 0.0) END) AS score,
     duration.between(d.createdAt, datetime()).months +
       duration.between(d.createdAt, datetime()).days / 30.0 AS ageInMonths
WITH d, score, CASE WHEN ageInMonths IS NULL THEN 0 ELSE ageInMonths END AS ageInMonths
WITH d, log10(score + 1) / ((ageInMonths + $hotAgeOffsetMonths) ^ $hotGravity) AS hotRank
ORDER BY hotRank DESC, d.createdAt DESC`;
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

  return {
    countQuery: `MATCH (d:Discussion)
WHERE ${predicates}
RETURN count(d) AS totalCount`,
    pageQuery: `MATCH (d:Discussion)
WHERE ${predicates}
${rankingClause(options.sortOption, channelPredicate)}
SKIP toInteger($offset)
LIMIT toInteger($limit)
RETURN d.id AS discussionId`,
  };
};
