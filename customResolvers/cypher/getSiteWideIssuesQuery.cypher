MATCH (issue:Issue)
WHERE issue.isOpen = $isOpen
AND ($searchInput = "" OR coalesce(issue.title, "") =~ $titleRegex OR coalesce(issue.body, "") =~ $bodyRegex)
AND (size($selectedChannels) = 0 OR issue.channelUniqueName IN $selectedChannels)
AND ($showOnlyServerRuleViolations = false OR coalesce(issue.flaggedServerRuleViolation, false) = true)
AND ($startDate IS NULL OR datetime(issue.createdAt) >= datetime($startDate))
AND ($endDate IS NULL OR datetime(issue.createdAt) <= datetime($endDate))
WITH count(issue) AS totalCount

MATCH (issue:Issue)
WHERE issue.isOpen = $isOpen
AND ($searchInput = "" OR coalesce(issue.title, "") =~ $titleRegex OR coalesce(issue.body, "") =~ $bodyRegex)
AND (size($selectedChannels) = 0 OR issue.channelUniqueName IN $selectedChannels)
AND ($showOnlyServerRuleViolations = false OR coalesce(issue.flaggedServerRuleViolation, false) = true)
AND ($startDate IS NULL OR datetime(issue.createdAt) >= datetime($startDate))
AND ($endDate IS NULL OR datetime(issue.createdAt) <= datetime($endDate))
OPTIONAL MATCH (issue)<-[:HAS_ISSUE]-(channel:Channel)
OPTIONAL MATCH (issue)<-[:AUTHORED_ISSUE]-(authorUser:User)
OPTIONAL MATCH (issue)<-[:AUTHORED_ISSUE]-(authorMod:ModerationProfile)
OPTIONAL MATCH (issue)-[:ACTIVITY_ON_ISSUE]->(reportAction:ModerationAction {actionType: "report"})
WITH issue, channel, authorUser, authorMod, count(reportAction) AS reportCount, totalCount
ORDER BY
  CASE WHEN $sort = "mostReports" THEN reportCount END DESC,
  CASE WHEN $sort = "oldest" THEN datetime(issue.createdAt).epochMillis END ASC,
  CASE WHEN $sort <> "oldest" THEN datetime(issue.createdAt).epochMillis END DESC,
  issue.issueNumber DESC
SKIP $offset
LIMIT $limit
RETURN {
  id: issue.id,
  issueNumber: issue.issueNumber,
  title: issue.title,
  body: issue.body,
  isOpen: issue.isOpen,
  createdAt: toString(issue.createdAt),
  updatedAt: toString(issue.updatedAt),
  relatedCommentId: issue.relatedCommentId,
  relatedDiscussionId: issue.relatedDiscussionId,
  relatedEventId: issue.relatedEventId,
  relatedImageId: issue.relatedImageId,
  relatedWikiPageId: issue.relatedWikiPageId,
  relatedWikiRevisionId: issue.relatedWikiRevisionId,
  relatedUsername: issue.relatedUsername,
  flaggedServerRuleViolation: issue.flaggedServerRuleViolation,
  locked: issue.locked,
  lockReason: issue.lockReason,
  channelUniqueName: issue.channelUniqueName,
  channelIconURL: channel.channelIconURL,
  authorName: coalesce(authorMod.displayName, authorUser.username, issue.authorName),
  reportCount: reportCount
} AS issue, totalCount
