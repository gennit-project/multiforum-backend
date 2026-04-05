// First, calculate the total count of discussions matching the criteria
// Only count discussions that have at least one non-archived discussion channel
MATCH (d:Discussion)
WHERE EXISTS {
  MATCH (d)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
  WHERE dc.archived IS NULL OR dc.archived = false
}
AND (CASE WHEN $sortOption = "top" THEN datetime(d.createdAt).epochMillis > datetime($startOfTimeFrame).epochMillis ELSE TRUE END)
AND ($searchInput = "" OR d.title =~ $titleRegex OR d.body =~ $bodyRegex)
AND (SIZE($selectedTags) = 0 OR ANY(t IN $selectedTags WHERE EXISTS((d)-[:HAS_TAG]->(:Tag {text: t}))))
// hasDownload controls discussion presentation, but download list membership
// additionally requires at least one attached DownloadableFile.
AND (
  $hasDownload IS NULL OR
  (
    $hasDownload = true AND
    d.hasDownload = true AND
    EXISTS { MATCH (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile) }
  ) OR
  (
    $hasDownload = false AND
    (d.hasDownload = false OR d.hasDownload IS NULL)
  )
)
WITH COUNT(d) AS totalCount

// Now, fetch the discussions with pagination and other filters
// Only match discussions that have at least one non-archived discussion channel
MATCH (d:Discussion)
WHERE EXISTS {
  MATCH (d)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
  WHERE dc.archived IS NULL OR dc.archived = false
}
AND (CASE WHEN $sortOption = "top" THEN datetime(d.createdAt).epochMillis > datetime($startOfTimeFrame).epochMillis ELSE TRUE END)
AND ($searchInput = "" OR d.title =~ $titleRegex OR d.body =~ $bodyRegex)
AND (SIZE($selectedTags) = 0 OR ANY(t IN $selectedTags WHERE EXISTS((d)-[:HAS_TAG]->(:Tag {text: t}))))
// hasDownload controls discussion presentation, but download list membership
// additionally requires at least one attached DownloadableFile.
AND (
  $hasDownload IS NULL OR
  (
    $hasDownload = true AND
    d.hasDownload = true AND
    EXISTS { MATCH (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile) }
  ) OR
  (
    $hasDownload = false AND
    (d.hasDownload = false OR d.hasDownload IS NULL)
  )
)

// Collect all discussion channels associated with a discussion
WITH d, totalCount
MATCH (dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(d)
WHERE (SIZE($selectedChannels) = 0 OR dc.channelUniqueName IN $selectedChannels)
AND (dc.isArchived IS NULL OR dc.isArchived = false) // Only include non-archived channels
WITH d, COLLECT(dc) AS discussionChannels, totalCount

// Unwind the discussion channels to work with them individually for fetching related data
UNWIND discussionChannels AS dc
OPTIONAL MATCH (dc)-[:UPVOTED_DISCUSSION]->(upvoter:User)
OPTIONAL MATCH (dc)-[:CONTAINS_COMMENT]->(c:Comment)
WITH d, dc, COLLECT(DISTINCT upvoter) AS upvotedByUsers, COUNT(DISTINCT c) AS commentsCount, totalCount
WITH d, COLLECT({dc: dc, upvotedByUsers: upvotedByUsers, commentsCount: commentsCount}) AS channelData, totalCount

// Now, you can proceed with calculating the score and other aggregations at the discussion level
WITH d, channelData, totalCount,
     REDUCE(s = 0, channel IN channelData | s + CASE WHEN coalesce(channel.dc.weightedVotesCount, 0) < 0 THEN 0 ELSE coalesce(channel.dc.weightedVotesCount, 0) END) AS score
WITH d, score, totalCount,
     [channel IN channelData |
      {
        id: channel.dc.id,
        createdAt: channel.dc.createdAt,
        channelUniqueName: channel.dc.channelUniqueName,
        discussionId: channel.dc.discussionId,
        UpvotedByUsers: [up in channel.upvotedByUsers | { username: up.username }],
        CommentsAggregate: {
            count: channel.commentsCount
        }
      }] AS discussionChannels

WITH d, discussionChannels, score, totalCount

// Handle tags
OPTIONAL MATCH (d)-[:HAS_TAG]->(tag:Tag)

WITH d, totalCount,
    COLLECT(DISTINCT tag.text) AS tagsText,
    discussionChannels,
    score

// Filter by tag
WHERE SIZE($selectedTags) = 0 OR ANY(t IN tagsText WHERE t IN $selectedTags)

OPTIONAL MATCH (d)<-[:POSTED_DISCUSSION]-(author:User)
OPTIONAL MATCH (author)-[:HAS_SERVER_ROLE]->(serverRole:ServerRole)

// Calculate the discussion's age in months
WITH d, totalCount, 
  tagsText, 
  author, 
  serverRole,
  discussionChannels, 
  score,
  duration.between(d.createdAt, datetime()).months + 
    duration.between(d.createdAt, datetime()).days / 30.0 AS ageInMonths

// Give a default value for the age in months if it's null
WITH d, totalCount, 
  tagsText, 
  author, 
  serverRole,
  discussionChannels, 
  score,
  CASE WHEN ageInMonths IS NULL THEN 0 ELSE ageInMonths END AS ageInMonths

// Calculate the rank based on the age in months and the score
WITH d, totalCount,
    tagsText,
    author, 
    serverRole,
    discussionChannels,
    CASE WHEN score < 0 THEN 0 ELSE score END AS score, 
    CASE WHEN $sortOption = "hot" THEN 10000 * log10(score + 1) / ((ageInMonths + 2) ^ 1.8) ELSE NULL END AS rank

WITH d, totalCount, tagsText, author, discussionChannels, score, rank,
    COLLECT(DISTINCT serverRole) AS serverRoles

WITH d, totalCount, tagsText, author, discussionChannels, score, rank, serverRoles

// Sort based on individual elements, not the collection
ORDER BY 
    CASE WHEN $sortOption = "new" THEN d.createdAt END DESC,
    CASE WHEN $sortOption = "top" THEN score END DESC,
    CASE WHEN $sortOption = "hot" THEN rank END DESC,
    d.createdAt DESC

// Apply pagination
WITH totalCount, d, tagsText, author, discussionChannels, score, rank, serverRoles
SKIP toInteger($offset)
LIMIT toInteger($limit)

OPTIONAL MATCH (d)-[:HAS_ALBUM]->(album:Album)
OPTIONAL MATCH (album)-[:HAS_IMAGE]->(image:Image)
WHERE image.id IS NOT NULL

WITH totalCount, d, tagsText, author, discussionChannels, score, rank, serverRoles, album,
     COLLECT(DISTINCT CASE WHEN image IS NOT NULL THEN {
         id: image.id,
         url: image.url,
         alt: image.alt,
         caption: image.caption
     } END) AS albumImages

// Check if the logged-in user has favorited this discussion
OPTIONAL MATCH (favUser:User {username: $loggedInUsername})-[:DEFAULT_FAVORITES_DISCUSSIONS]->(d)
WITH totalCount, d, tagsText, author, discussionChannels, score, rank, serverRoles, album, albumImages,
     CASE WHEN $loggedInUsername IS NULL OR $loggedInUsername = "" THEN null WHEN favUser IS NOT NULL THEN true ELSE false END AS isFavorited

// Return the results
RETURN {
    id: d.id,
    title: d.title,
    body: d.body,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    hasSensitiveContent: d.hasSensitiveContent,
    hasSpoiler: d.hasSpoiler,
    Author: CASE
                WHEN author IS NULL THEN null
                ELSE {
                    username: author.username,
                    displayName: author.displayName,
                    profilePicURL: author.profilePicURL,
                    createdAt: author.createdAt,
                    discussionKarma: author.commentKarma,
                    commentKarma: author.discussionKarma,
                    ServerRoles: serverRoles
                }
              END,
    DiscussionChannels: discussionChannels,
    Tags: [t IN tagsText | {text: t}],
    Album: CASE
      WHEN album IS NULL THEN null
      ELSE {
        id: album.id,
        imageOrder: album.imageOrder,
        Images: albumImages
      }
    END,
    isFavorited: isFavorited
} AS discussion, totalCount
