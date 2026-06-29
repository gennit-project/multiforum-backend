import { DateTime } from "luxon";
import neo4j, { type Driver } from "neo4j-driver";
import { logger } from "../../logger.js";
import type { QueryResult, Session } from "neo4j-driver";

type Input = {
  driver: Driver;
};

type Args = {
  startDate?: string | null;
  endDate?: string | null;
  channelUniqueNames?: string[] | null;
  limit?: number | null;
  sortBy?: string | null;
  sortDirection?: string | null;
};

type ChannelHealthRow = {
  id: string;
  channelUniqueName: string;
  displayName: string | null;
  channelIconURL: string | null;
  discussionCount: number;
  commentCount: number;
  eventCount: number;
  downloadCount: number;
  voteCount: number;
  uniqueContributorCount: number;
  openIssueCount: number;
  issueOpenedCount: number;
  moderationActionCount: number;
  archivedContentCount: number;
  lockedContentCount: number;
  oldestOpenIssueAgeDays: number | null;
  issuesPerHundredContributions: number;
  activityScore: number;
  healthLabel: string;
};

type AttentionItem = {
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  description: string;
  channelUniqueName?: string | null;
  issueNumber?: number | null;
  metric?: string | null;
  value?: number | null;
};

type ChannelHealthSortKey =
  | "channelUniqueName"
  | "displayName"
  | "discussionCount"
  | "commentCount"
  | "eventCount"
  | "downloadCount"
  | "voteCount"
  | "uniqueContributorCount"
  | "openIssueCount"
  | "issueOpenedCount"
  | "moderationActionCount"
  | "archivedContentCount"
  | "lockedContentCount"
  | "oldestOpenIssueAgeDays"
  | "issuesPerHundredContributions"
  | "activityScore"
  | "healthLabel";

type SortDirection = "asc" | "desc";

const DEFAULT_RANGE_DAYS = 30;
const DEFAULT_CHANNEL_LIMIT = 25;
const DEFAULT_CHANNEL_SORT_BY: ChannelHealthSortKey = "activityScore";
const DEFAULT_CHANNEL_SORT_DIRECTION: SortDirection = "desc";
const CHANNEL_HEALTH_SORT_KEYS = new Set<ChannelHealthSortKey>([
  "channelUniqueName",
  "displayName",
  "discussionCount",
  "commentCount",
  "eventCount",
  "downloadCount",
  "voteCount",
  "uniqueContributorCount",
  "openIssueCount",
  "issueOpenedCount",
  "moderationActionCount",
  "archivedContentCount",
  "lockedContentCount",
  "oldestOpenIssueAgeDays",
  "issuesPerHundredContributions",
  "activityScore",
  "healthLabel",
]);
const SERVER_SCOPED_ISSUE_WHERE =
  "(coalesce(issue.flaggedServerRuleViolation, false) = true OR issue.channelUniqueName IS NULL)";

const toNumber = (value: unknown): number => {
  if (neo4j.isInt(value)) return value.toNumber();
  if (typeof value === "number") return value;
  if (value == null) return 0;
  return Number(value);
};

const toNullableNumber = (value: unknown): number | null => {
  if (value == null) return null;
  return toNumber(value);
};

const sanitize = (value: unknown): unknown => {
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitize(entry)])
    );
  }
  return value;
};

const parseDateArg = (value: string | null | undefined, fallback: DateTime) => {
  if (!value) return fallback;
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  return parsed.isValid ? parsed : fallback;
};

const parseSortBy = (value: string | null | undefined): ChannelHealthSortKey => {
  if (value && CHANNEL_HEALTH_SORT_KEYS.has(value as ChannelHealthSortKey)) {
    return value as ChannelHealthSortKey;
  }
  return DEFAULT_CHANNEL_SORT_BY;
};

const parseSortDirection = (value: string | null | undefined): SortDirection => {
  return value === "asc" || value === "desc"
    ? value
    : DEFAULT_CHANNEL_SORT_DIRECTION;
};

const compareChannelRows = (
  a: ChannelHealthRow,
  b: ChannelHealthRow,
  sortBy: ChannelHealthSortKey,
  sortDirection: SortDirection
) => {
  const aValue = a[sortBy];
  const bValue = b[sortBy];
  let comparison = 0;

  if (typeof aValue === "string" || typeof bValue === "string") {
    comparison = String(aValue || "").localeCompare(String(bValue || ""));
  } else {
    comparison = toNumber(aValue) - toNumber(bValue);
  }

  if (comparison !== 0) {
    return sortDirection === "asc" ? comparison : -comparison;
  }

  comparison = b.activityScore - a.activityScore;
  if (comparison === 0) {
    comparison = b.openIssueCount - a.openIssueCount;
  }
  if (comparison === 0) {
    comparison = a.channelUniqueName.localeCompare(b.channelUniqueName);
  }

  return comparison;
};

const getHealthLabel = (row: Omit<ChannelHealthRow, "healthLabel">): string => {
  if ((row.oldestOpenIssueAgeDays || 0) >= 14 || row.openIssueCount >= 10) {
    return "Needs review";
  }
  if (row.issuesPerHundredContributions >= 20 && row.issueOpenedCount >= 3) {
    return "High moderation load";
  }
  if (row.activityScore === 0) {
    return "Quiet";
  }
  if (row.activityScore >= 20 && row.issuesPerHundredContributions < 5) {
    return "Healthy activity";
  }
  return "Active";
};

const buildAttentionItems = (rows: ChannelHealthRow[]): AttentionItem[] => {
  const staleIssueItems = rows
    .filter((row) => (row.oldestOpenIssueAgeDays || 0) >= 7)
    .sort((a, b) => (b.oldestOpenIssueAgeDays || 0) - (a.oldestOpenIssueAgeDays || 0))
    .slice(0, 5)
    .map((row) => ({
      severity: (row.oldestOpenIssueAgeDays || 0) >= 30 ? "CRITICAL" as const : "WARNING" as const,
      title: "Stale open issues",
      description: `${row.channelUniqueName} has ${row.openIssueCount} open issue${row.openIssueCount === 1 ? "" : "s"}; oldest is ${row.oldestOpenIssueAgeDays} day${row.oldestOpenIssueAgeDays === 1 ? "" : "s"} old.`,
      channelUniqueName: row.channelUniqueName,
      metric: "oldestOpenIssueAgeDays",
      value: row.oldestOpenIssueAgeDays,
    }));

  const highPressureItems = rows
    .filter((row) => row.issueOpenedCount >= 3 && row.issuesPerHundredContributions >= 20)
    .sort((a, b) => b.issuesPerHundredContributions - a.issuesPerHundredContributions)
    .slice(0, 5)
    .map((row) => ({
      severity: "WARNING" as const,
      title: "High issue pressure",
      description: `${row.channelUniqueName} opened ${row.issuesPerHundredContributions.toFixed(1)} issues per 100 contributions in this period.`,
      channelUniqueName: row.channelUniqueName,
      metric: "issuesPerHundredContributions",
      value: row.issuesPerHundredContributions,
    }));

  const underRespondedItems = rows
    .filter((row) => row.openIssueCount >= 3 && row.moderationActionCount === 0)
    .sort((a, b) => b.openIssueCount - a.openIssueCount)
    .slice(0, 5)
    .map((row) => ({
      severity: "WARNING" as const,
      title: "Open issues without recent mod activity",
      description: `${row.channelUniqueName} has ${row.openIssueCount} open issues and no moderation actions in this period.`,
      channelUniqueName: row.channelUniqueName,
      metric: "openIssueCount",
      value: row.openIssueCount,
    }));

  return [...staleIssueItems, ...highPressureItems, ...underRespondedItems].slice(0, 10);
};

const buildIssueAging = (ages: number[]) => [
  { label: "<1 day", minDays: 0, maxDays: 0, count: ages.filter((age) => age < 1).length },
  { label: "1-3 days", minDays: 1, maxDays: 3, count: ages.filter((age) => age >= 1 && age <= 3).length },
  { label: "4-7 days", minDays: 4, maxDays: 7, count: ages.filter((age) => age >= 4 && age <= 7).length },
  { label: "8-30 days", minDays: 8, maxDays: 30, count: ages.filter((age) => age >= 8 && age <= 30).length },
  { label: "30+ days", minDays: 31, maxDays: null, count: ages.filter((age) => age > 30).length },
];

const getMedian = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] || 0) + (sorted[mid] || 0)) / 2;
  }
  return sorted[mid] ?? null;
};

const channelHealthQuery = `
  WITH date($startDate) AS startDate,
       date($endDate) AS endDate,
       $channelUniqueNames AS channelUniqueNames
  MATCH (c:Channel)
  WHERE coalesce(c.deleted, false) = false
    AND (size(channelUniqueNames) = 0 OR c.uniqueName IN channelUniqueNames)

  CALL {
    WITH c, startDate, endDate
    MATCH (c)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(d:Discussion)
    WHERE date(datetime(dc.createdAt)) >= startDate
      AND date(datetime(dc.createdAt)) <= endDate
      AND coalesce(d.deleted, false) = false
    RETURN count(DISTINCT dc) AS discussionCount,
           count(DISTINCT CASE WHEN coalesce(d.hasDownload, false) THEN dc END) AS downloadCount,
           count(DISTINCT CASE WHEN coalesce(dc.archived, false) THEN dc END) AS archivedDiscussions,
           count(DISTINCT CASE WHEN coalesce(dc.locked, false) THEN dc END) AS lockedDiscussions
  }

  CALL {
    WITH c, startDate, endDate
    MATCH (c)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)-[:POSTED_IN_CHANNEL]->(e:Event)
    WHERE date(datetime(ec.createdAt)) >= startDate
      AND date(datetime(ec.createdAt)) <= endDate
      AND coalesce(e.deleted, false) = false
    RETURN count(DISTINCT ec) AS eventCount,
           count(DISTINCT CASE WHEN coalesce(ec.archived, false) THEN ec END) AS archivedEvents,
           count(DISTINCT CASE WHEN coalesce(ec.locked, false) THEN ec END) AS lockedEvents
  }

  CALL {
    WITH c, startDate, endDate
    CALL {
      WITH c, startDate, endDate
      MATCH (c)-[:HAS_COMMENT]->(comment:Comment)
      WHERE date(datetime(comment.createdAt)) >= startDate
        AND date(datetime(comment.createdAt)) <= endDate
        AND coalesce(comment.deleted, false) = false
      RETURN comment
      UNION
      WITH c, startDate, endDate
      MATCH (c)<-[:POSTED_IN_CHANNEL]-(:DiscussionChannel)-[:CONTAINS_COMMENT]->(comment:Comment)
      WHERE date(datetime(comment.createdAt)) >= startDate
        AND date(datetime(comment.createdAt)) <= endDate
        AND coalesce(comment.deleted, false) = false
      RETURN comment
      UNION
      WITH c, startDate, endDate
      MATCH (c)<-[:POSTED_IN_CHANNEL]-(:EventChannel)-[:CONTAINS_COMMENT]->(comment:Comment)
      WHERE date(datetime(comment.createdAt)) >= startDate
        AND date(datetime(comment.createdAt)) <= endDate
        AND coalesce(comment.deleted, false) = false
      RETURN comment
    }
    RETURN count(DISTINCT comment) AS commentCount,
           count(DISTINCT CASE WHEN coalesce(comment.archived, false) THEN comment END) AS archivedComments,
           count(DISTINCT CASE WHEN coalesce(comment.locked, false) THEN comment END) AS lockedComments
  }

  CALL {
    WITH c, startDate, endDate
    CALL {
      WITH c, startDate, endDate
      MATCH (c)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)<-[vote:UPVOTED_DISCUSSION|SUPER_UPVOTED_DISCUSSION]-(:User)
      WHERE date(datetime(dc.createdAt)) >= startDate AND date(datetime(dc.createdAt)) <= endDate
      RETURN vote
      UNION
      WITH c, startDate, endDate
      MATCH (c)-[:HAS_COMMENT]->(comment:Comment)<-[vote:UPVOTED_COMMENT|SUPER_UPVOTED_COMMENT]-(:User)
      WHERE date(datetime(comment.createdAt)) >= startDate AND date(datetime(comment.createdAt)) <= endDate
      RETURN vote
      UNION
      WITH c, startDate, endDate
      MATCH (c)<-[:POSTED_IN_CHANNEL]-(:DiscussionChannel)-[:CONTAINS_COMMENT]->(comment:Comment)<-[vote:UPVOTED_COMMENT|SUPER_UPVOTED_COMMENT]-(:User)
      WHERE date(datetime(comment.createdAt)) >= startDate AND date(datetime(comment.createdAt)) <= endDate
      RETURN vote
      UNION
      WITH c, startDate, endDate
      MATCH (c)<-[:POSTED_IN_CHANNEL]-(:EventChannel)-[:CONTAINS_COMMENT]->(comment:Comment)<-[vote:UPVOTED_COMMENT|SUPER_UPVOTED_COMMENT]-(:User)
      WHERE date(datetime(comment.createdAt)) >= startDate AND date(datetime(comment.createdAt)) <= endDate
      RETURN vote
    }
    RETURN count(DISTINCT vote) AS voteCount
  }

  CALL {
    WITH c, startDate, endDate
    CALL {
      WITH c, startDate, endDate
      MATCH (contributor)-[:POSTED_DISCUSSION]->(:Discussion)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(c)
      WHERE date(datetime(dc.createdAt)) >= startDate AND date(datetime(dc.createdAt)) <= endDate
      RETURN contributor
      UNION
      WITH c, startDate, endDate
      MATCH (contributor)-[:POSTED_BY]->(:Event)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)-[:POSTED_IN_CHANNEL]->(c)
      WHERE date(datetime(ec.createdAt)) >= startDate AND date(datetime(ec.createdAt)) <= endDate
      RETURN contributor
      UNION
      WITH c, startDate, endDate
      MATCH (contributor)-[:AUTHORED_COMMENT]->(comment:Comment)<-[:HAS_COMMENT]-(c)
      WHERE date(datetime(comment.createdAt)) >= startDate AND date(datetime(comment.createdAt)) <= endDate
      RETURN contributor
      UNION
      WITH c, startDate, endDate
      MATCH (contributor)-[:AUTHORED_COMMENT]->(comment:Comment)<-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(c)
      WHERE date(datetime(comment.createdAt)) >= startDate AND date(datetime(comment.createdAt)) <= endDate
      RETURN contributor
      UNION
      WITH c, startDate, endDate
      MATCH (contributor)-[:AUTHORED_COMMENT]->(comment:Comment)<-[:CONTAINS_COMMENT]-(:EventChannel)-[:POSTED_IN_CHANNEL]->(c)
      WHERE date(datetime(comment.createdAt)) >= startDate AND date(datetime(comment.createdAt)) <= endDate
      RETURN contributor
    }
    RETURN count(DISTINCT contributor) AS uniqueContributorCount
  }

  CALL {
    WITH c, startDate, endDate
    MATCH (c)-[:HAS_ISSUE]->(issue:Issue)
    WHERE ${SERVER_SCOPED_ISSUE_WHERE}
    RETURN count(DISTINCT CASE WHEN coalesce(issue.isOpen, false) THEN issue END) AS openIssueCount,
           count(DISTINCT CASE WHEN date(datetime(issue.createdAt)) >= startDate AND date(datetime(issue.createdAt)) <= endDate THEN issue END) AS issueOpenedCount,
           max(CASE WHEN coalesce(issue.isOpen, false) THEN duration.inDays(date(datetime(issue.createdAt)), date()).days ELSE null END) AS oldestOpenIssueAgeDays
  }

  CALL {
    WITH c, startDate, endDate
    MATCH (c)-[:HAS_ISSUE]->(issue:Issue)-[:ACTIVITY_ON_ISSUE]->(action:ModerationAction)
    WHERE date(datetime(action.createdAt)) >= startDate AND date(datetime(action.createdAt)) <= endDate
      AND ${SERVER_SCOPED_ISSUE_WHERE}
    RETURN count(DISTINCT action) AS moderationActionCount
  }

  WITH c,
       discussionCount,
       commentCount,
       eventCount,
       downloadCount,
       voteCount,
       uniqueContributorCount,
       openIssueCount,
       issueOpenedCount,
       moderationActionCount,
       archivedDiscussions + archivedEvents + archivedComments AS archivedContentCount,
       lockedDiscussions + lockedEvents + lockedComments + CASE WHEN coalesce(c.locked, false) THEN 1 ELSE 0 END AS lockedContentCount,
       oldestOpenIssueAgeDays,
       discussionCount + commentCount + eventCount AS contributionCount
  WITH {
    id: c.uniqueName,
    channelUniqueName: c.uniqueName,
    displayName: c.displayName,
    channelIconURL: c.channelIconURL,
    discussionCount: discussionCount,
    commentCount: commentCount,
    eventCount: eventCount,
    downloadCount: downloadCount,
    voteCount: voteCount,
    uniqueContributorCount: uniqueContributorCount,
    openIssueCount: openIssueCount,
    issueOpenedCount: issueOpenedCount,
    moderationActionCount: moderationActionCount,
    archivedContentCount: archivedContentCount,
    lockedContentCount: lockedContentCount,
    oldestOpenIssueAgeDays: oldestOpenIssueAgeDays,
    issuesPerHundredContributions: CASE WHEN contributionCount = 0 THEN 0.0 ELSE toFloat(issueOpenedCount) / toFloat(contributionCount) * 100.0 END,
    activityScore: contributionCount
  } AS row
  ORDER BY row.activityScore DESC, row.openIssueCount DESC, row.channelUniqueName ASC
  RETURN collect(row) AS allChannelHealth
`;

const timeSeriesQuery = `
  WITH date($startDate) AS startDate,
       date($endDate) AS endDate,
       $channelUniqueNames AS channelUniqueNames
  CALL {
    WITH startDate, endDate, channelUniqueNames
    UNWIND range(0, duration.inDays(startDate, endDate).days) AS offset
    WITH startDate + duration({days: offset}) AS day, channelUniqueNames

    CALL {
      WITH day, channelUniqueNames
      MATCH (c:Channel)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(d:Discussion)
      WHERE date(datetime(dc.createdAt)) = day
        AND coalesce(c.deleted, false) = false
        AND (size(channelUniqueNames) = 0 OR c.uniqueName IN channelUniqueNames)
        AND coalesce(d.deleted, false) = false
      RETURN count(DISTINCT dc) AS discussions,
             count(DISTINCT CASE WHEN coalesce(d.hasDownload, false) THEN dc END) AS downloads
    }
    CALL {
      WITH day, channelUniqueNames
      MATCH (c:Channel)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)-[:POSTED_IN_CHANNEL]->(e:Event)
      WHERE date(datetime(ec.createdAt)) = day
        AND coalesce(c.deleted, false) = false
        AND (size(channelUniqueNames) = 0 OR c.uniqueName IN channelUniqueNames)
        AND coalesce(e.deleted, false) = false
      RETURN count(DISTINCT ec) AS events
    }
    CALL {
      WITH day, channelUniqueNames
      CALL {
        WITH day, channelUniqueNames
        MATCH (c:Channel)-[:HAS_COMMENT]->(comment:Comment)
        WHERE date(datetime(comment.createdAt)) = day
          AND coalesce(c.deleted, false) = false
          AND coalesce(comment.deleted, false) = false
          AND (size(channelUniqueNames) = 0 OR c.uniqueName IN channelUniqueNames)
        RETURN comment
        UNION
        WITH day, channelUniqueNames
        MATCH (c:Channel)<-[:POSTED_IN_CHANNEL]-(:DiscussionChannel)-[:CONTAINS_COMMENT]->(comment:Comment)
        WHERE date(datetime(comment.createdAt)) = day
          AND coalesce(c.deleted, false) = false
          AND coalesce(comment.deleted, false) = false
          AND (size(channelUniqueNames) = 0 OR c.uniqueName IN channelUniqueNames)
        RETURN comment
        UNION
        WITH day, channelUniqueNames
        MATCH (c:Channel)<-[:POSTED_IN_CHANNEL]-(:EventChannel)-[:CONTAINS_COMMENT]->(comment:Comment)
        WHERE date(datetime(comment.createdAt)) = day
          AND coalesce(c.deleted, false) = false
          AND coalesce(comment.deleted, false) = false
          AND (size(channelUniqueNames) = 0 OR c.uniqueName IN channelUniqueNames)
        RETURN comment
      }
      RETURN count(DISTINCT comment) AS comments
    }
    CALL {
      WITH day, channelUniqueNames
      MATCH (issue:Issue)
      WHERE date(datetime(issue.createdAt)) = day
        AND (size(channelUniqueNames) = 0 OR issue.channelUniqueName IN channelUniqueNames)
        AND ${SERVER_SCOPED_ISSUE_WHERE}
      RETURN count(DISTINCT issue) AS issuesOpened
    }
    CALL {
      WITH day, channelUniqueNames
      MATCH (issue:Issue)-[:ACTIVITY_ON_ISSUE]->(action:ModerationAction)
      WHERE date(datetime(action.createdAt)) = day
        AND (size(channelUniqueNames) = 0 OR issue.channelUniqueName IN channelUniqueNames)
        AND ${SERVER_SCOPED_ISSUE_WHERE}
      RETURN count(DISTINCT action) AS moderationActions
    }

    RETURN collect({
      date: toString(day),
      discussions: discussions,
      comments: comments,
      events: events,
      downloads: downloads,
      issuesOpened: issuesOpened,
      moderationActions: moderationActions
    }) AS timeSeries
  }
  RETURN timeSeries
`;

const issueSummaryQuery = `
  WITH date($startDate) AS startDate,
       date($endDate) AS endDate,
       $channelUniqueNames AS channelUniqueNames
  MATCH (issue:Issue)
  WHERE date(datetime(issue.createdAt)) >= startDate
    AND date(datetime(issue.createdAt)) <= endDate
    AND (size(channelUniqueNames) = 0 OR issue.channelUniqueName IN channelUniqueNames)
    AND ${SERVER_SCOPED_ISSUE_WHERE}
  OPTIONAL MATCH (issue)-[:ACTIVITY_ON_ISSUE]->(closeAction:ModerationAction)
  WHERE toLower(coalesce(closeAction.actionType, "")) CONTAINS "close"
  WITH issue, count(closeAction) AS closeActions
  RETURN count(DISTINCT issue) AS issueOpenedCount,
         count(DISTINCT CASE WHEN closeActions > 0 OR coalesce(issue.isOpen, false) = false THEN issue END) AS issueClosedCount
`;

const openIssueSummaryQuery = `
  WITH $channelUniqueNames AS channelUniqueNames
  MATCH (issue:Issue)
  WHERE coalesce(issue.isOpen, false) = true
    AND (size(channelUniqueNames) = 0 OR issue.channelUniqueName IN channelUniqueNames)
    AND ${SERVER_SCOPED_ISSUE_WHERE}
  RETURN count(DISTINCT issue) AS totalOpenIssueCount,
         collect(duration.inDays(date(datetime(issue.createdAt)), date()).days) AS openIssueAges
`;

const moderationActionTotalQuery = `
  WITH date($startDate) AS startDate,
       date($endDate) AS endDate,
       $channelUniqueNames AS channelUniqueNames
  MATCH (issue:Issue)-[:ACTIVITY_ON_ISSUE]->(action:ModerationAction)
  WHERE date(datetime(action.createdAt)) >= startDate
    AND date(datetime(action.createdAt)) <= endDate
    AND (size(channelUniqueNames) = 0 OR issue.channelUniqueName IN channelUniqueNames)
    AND ${SERVER_SCOPED_ISSUE_WHERE}
  RETURN count(DISTINCT action) AS totalModerationActionCount
`;

const suspensionTotalQuery = `
  WITH date($startDate) AS startDate,
       date($endDate) AS endDate,
       $channelUniqueNames AS channelUniqueNames
  MATCH (s:Suspension)
  WHERE date(datetime(s.createdAt)) >= startDate
    AND date(datetime(s.createdAt)) <= endDate
  OPTIONAL MATCH (s)-[:HAS_CONTEXT]->(issue:Issue)
  WITH s, issue, channelUniqueNames
  WHERE size(channelUniqueNames) = 0 OR issue.channelUniqueName IN channelUniqueNames
  RETURN count(DISTINCT s) AS suspensionCount
`;

const runDashboardQuery = async (
  session: Session,
  name: string,
  query: string,
  params: Record<string, unknown>
): Promise<QueryResult> => {
  try {
    return await session.run(query, params);
  } catch (error) {
    logger.error(`Error fetching server health dashboard subquery: ${name}`, error);
    throw error;
  }
};

const getServerHealthDashboardResolver = ({ driver }: Input) => {
  return async (_parent: unknown, args: Args = {}) => {
    const now = DateTime.utc();
    const requestedEnd = parseDateArg(args.endDate, now);
    const requestedStart = parseDateArg(
      args.startDate,
      requestedEnd.minus({ days: DEFAULT_RANGE_DAYS })
    );
    const [start, end] = requestedStart > requestedEnd
      ? [requestedEnd, requestedStart]
      : [requestedStart, requestedEnd];
    const startDate = start.toISODate() || now.toISODate();
    const endDate = end.toISODate() || now.toISODate();
    const limit = args.limit || DEFAULT_CHANNEL_LIMIT;
    const sortBy = parseSortBy(args.sortBy);
    const sortDirection = parseSortDirection(args.sortDirection);
    const channelUniqueNames = args.channelUniqueNames || [];
    const session = driver.session({ defaultAccessMode: "READ" });

    try {
      const params = {
        startDate,
        endDate,
        channelUniqueNames,
        limit,
      };
      const channelResult = await runDashboardQuery(session, "channelHealth", channelHealthQuery, params);
      const timeSeriesResult = await runDashboardQuery(session, "timeSeries", timeSeriesQuery, params);
      const issueSummaryResult = await runDashboardQuery(session, "issueSummary", issueSummaryQuery, params);
      const openIssueSummaryResult = await runDashboardQuery(session, "openIssueSummary", openIssueSummaryQuery, params);
      const moderationActionTotalResult = await runDashboardQuery(session, "moderationActionTotal", moderationActionTotalQuery, params);
      const suspensionTotalResult = await runDashboardQuery(session, "suspensionTotal", suspensionTotalQuery, params);

      const channelRecord = channelResult.records[0];
      const allChannelHealth = sanitize(channelRecord?.get("allChannelHealth") || []) as Array<Omit<ChannelHealthRow, "healthLabel">>;
      const normalizedChannelHealth = allChannelHealth.map((row) => {
        const normalized = {
          ...row,
          oldestOpenIssueAgeDays: toNullableNumber(row.oldestOpenIssueAgeDays),
          issuesPerHundredContributions: toNumber(row.issuesPerHundredContributions),
        };
        return {
          ...normalized,
          healthLabel: getHealthLabel(normalized),
        };
      });
      const channelHealth = normalizedChannelHealth
        .sort((a, b) => compareChannelRows(a, b, sortBy, sortDirection))
        .slice(0, limit);
      const timeSeries = sanitize(timeSeriesResult.records[0]?.get("timeSeries") || []);
      const issueSummary = issueSummaryResult.records[0];
      const openIssueSummary = openIssueSummaryResult.records[0];
      const totalModerationActionCount = toNumber(
        moderationActionTotalResult.records[0]?.get("totalModerationActionCount")
      );
      const suspensionCount = toNumber(
        suspensionTotalResult.records[0]?.get("suspensionCount")
      );
      const openIssueAges = (sanitize(openIssueSummary?.get("openIssueAges") || []) as unknown[])
        .map(toNumber);
      const issueAging = buildIssueAging(openIssueAges);
      const medianOpenIssueAgeDays = getMedian(openIssueAges);
      const summary = {
        activeChannelCount: allChannelHealth.filter((row) => row.activityScore > 0).length,
        discussionCount: allChannelHealth.reduce((total, row) => total + toNumber(row.discussionCount), 0),
        commentCount: allChannelHealth.reduce((total, row) => total + toNumber(row.commentCount), 0),
        eventCount: allChannelHealth.reduce((total, row) => total + toNumber(row.eventCount), 0),
        downloadCount: allChannelHealth.reduce((total, row) => total + toNumber(row.downloadCount), 0),
        voteCount: allChannelHealth.reduce((total, row) => total + toNumber(row.voteCount), 0),
        openIssueCount: toNumber(openIssueSummary?.get("totalOpenIssueCount")),
        issueOpenedCount: toNumber(issueSummary?.get("issueOpenedCount")),
        issueClosedCount: toNumber(issueSummary?.get("issueClosedCount")),
        moderationActionCount: totalModerationActionCount,
        archivedContentCount: allChannelHealth.reduce((total, row) => total + toNumber(row.archivedContentCount), 0),
        lockedContentCount: allChannelHealth.reduce((total, row) => total + toNumber(row.lockedContentCount), 0),
        suspensionCount,
        medianOpenIssueAgeDays,
      };

      return {
        startDate,
        endDate,
        generatedAt: now.toISO(),
        summary,
        timeSeries,
        channelHealth,
        issueAging,
        attentionItems: buildAttentionItems(channelHealth),
      };
    } catch (error) {
      logger.error("Error fetching server health dashboard:", error);
      throw new Error("Failed to fetch server health dashboard");
    } finally {
      await session.close();
    }
  };
};

export default getServerHealthDashboardResolver;
