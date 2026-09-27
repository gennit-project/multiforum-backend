// Hydrate only the IDs selected by getDiscussionChannelPageQuery. The explicit
// position keeps the page query's ranking order stable.
UNWIND range(0, size($discussionChannelIds) - 1) AS pagePosition
WITH pagePosition, $discussionChannelIds[pagePosition] AS discussionChannelId
MATCH (dc:DiscussionChannel {id: discussionChannelId})-[:POSTED_IN_CHANNEL]->(d:Discussion)
WITH pagePosition, dc, d,
     CASE WHEN coalesce(dc.weightedVotesCount, 0.0) < 0 THEN 0.0 ELSE coalesce(dc.weightedVotesCount, 0.0) END AS weightedVotesCount

OPTIONAL MATCH (d)-[:HAS_TAG]->(tag:Tag)
WITH pagePosition, dc, d, COLLECT(DISTINCT tag.text) AS tagsText, weightedVotesCount

OPTIONAL MATCH (d)<-[:POSTED_DISCUSSION]-(author:User)
WITH pagePosition, dc, d, author, tagsText, weightedVotesCount

OPTIONAL MATCH (upvoter:User)-[:UPVOTED_DISCUSSION]->(dc)
WITH pagePosition, dc, d, author, tagsText, weightedVotesCount,
     COUNT(DISTINCT upvoter) AS totalUpvoters,
     COALESCE($loggedInUsername, "") AS loggedInUsername

OPTIONAL MATCH (loggedInUser:User {username: loggedInUsername})-[:UPVOTED_DISCUSSION]->(dc)
OPTIONAL MATCH (loggedInSuperUpvoter:User {username: loggedInUsername})-[:SUPER_UPVOTED_DISCUSSION]->(dc)
WITH pagePosition, dc, d, author, tagsText, weightedVotesCount, totalUpvoters,
     CASE
         WHEN loggedInUsername = "" THEN []
         WHEN loggedInUser IS NOT NULL THEN [{username: loggedInUser.username}]
         ELSE []
     END AS loggedInUserUpvote,
     CASE
         WHEN loggedInUsername = "" THEN []
         WHEN loggedInSuperUpvoter IS NOT NULL THEN [{username: loggedInSuperUpvoter.username}]
         ELSE []
     END AS loggedInUserSuperUpvote

OPTIONAL MATCH (dc)-[:CONTAINS_COMMENT]->(c:Comment)
WHERE c.isFeedbackComment IS NULL OR c.isFeedbackComment = false
WITH pagePosition, dc, d, author, tagsText, weightedVotesCount, totalUpvoters,
     loggedInUserUpvote, loggedInUserSuperUpvote, COUNT(DISTINCT c) AS commentsCount

OPTIONAL MATCH (d)-[:HAS_ALBUM]->(album:Album)
OPTIONAL MATCH (album)-[:HAS_IMAGE]->(image:Image)
WHERE image.id IS NOT NULL
  AND (image.archived IS NULL OR image.archived = false)
  AND (image.permanentlyRemoved IS NULL OR image.permanentlyRemoved = false)
  AND ($mayAccessSensitiveContent OR coalesce(image.hasSensitiveContent, false) = false)

WITH pagePosition, dc, d, author, tagsText, loggedInUserUpvote, loggedInUserSuperUpvote, totalUpvoters,
     weightedVotesCount, commentsCount,
     album,
     [img IN COLLECT(DISTINCT CASE WHEN image IS NOT NULL THEN {
         id: image.id,
         url: image.url,
         alt: image.alt,
         caption: image.caption,
         archived: image.archived,
         permanentlyRemoved: image.permanentlyRemoved
     } END) WHERE img IS NOT NULL] AS albumImages

OPTIONAL MATCH (d)-[:HAS_DOWNLOADABLE_FILE]->(downloadableFile:DownloadableFile)
WHERE downloadableFile.permanentlyRemoved IS NULL OR downloadableFile.permanentlyRemoved = false

WITH pagePosition, dc, d, author, tagsText, loggedInUserUpvote, loggedInUserSuperUpvote, totalUpvoters,
     weightedVotesCount, commentsCount, album, albumImages,
     [file IN COLLECT(DISTINCT CASE WHEN downloadableFile IS NOT NULL THEN {
         id: downloadableFile.id,
         scanStatus: downloadableFile.scanStatus
     } END) WHERE file IS NOT NULL] AS downloadableFiles

// Check if the logged-in user has favorited this discussion.
OPTIONAL MATCH (favUser:User {username: $loggedInUsername})-[:DEFAULT_FAVORITES_DISCUSSIONS]->(d)
WITH pagePosition, dc, d, author, tagsText, loggedInUserUpvote, loggedInUserSuperUpvote, totalUpvoters,
     weightedVotesCount, commentsCount, album, albumImages, downloadableFiles,
     CASE WHEN $loggedInUsername IS NULL OR $loggedInUsername = "" THEN null WHEN favUser IS NOT NULL THEN true ELSE false END AS isFavorited

// Include every assigned flair, including archived flairs. Archiving prevents
// future assignment but must not erase a historical discussion's category.
OPTIONAL MATCH (dc)-[:HAS_DISCUSSION_FLAIR]->(assignedFlair:DiscussionFlair)
WITH pagePosition, dc, d, author, tagsText, loggedInUserUpvote, loggedInUserSuperUpvote, totalUpvoters,
     weightedVotesCount, commentsCount, album, albumImages, downloadableFiles, isFavorited, assignedFlair
ORDER BY pagePosition, assignedFlair.order ASC, assignedFlair.displayName ASC
WITH pagePosition, dc, d, author, tagsText, loggedInUserUpvote, loggedInUserSuperUpvote, totalUpvoters,
     weightedVotesCount, commentsCount, album, albumImages, downloadableFiles, isFavorited,
     [flair IN COLLECT(DISTINCT assignedFlair) WHERE flair IS NOT NULL | {
         id: flair.id,
         channelUniqueName: flair.channelUniqueName,
         displayName: flair.displayName,
         color: flair.color,
         order: flair.order,
         archived: flair.archived
     }] AS assignedFlairs

RETURN {
    id: dc.id,
    archived: dc.archived,
    answered: dc.answered,
    locked: dc.locked,
    discussionId: d.id,
    createdAt: dc.createdAt,
    channelUniqueName: dc.channelUniqueName,
    weightedVotesCount: weightedVotesCount,
    Flairs: assignedFlairs,
    CommentsAggregate: {
        count: commentsCount
    },
    UpvotedByUsers: [up in loggedInUserUpvote | { username: up.username }],
    UpvotedByUsersAggregate: {
        count: totalUpvoters
    },
    SuperUpvotedByUsers: [sup in loggedInUserSuperUpvote | { username: sup.username }],
    Discussion: {
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
                      discussionKarma: author.discussionKarma,
                      commentKarma: author.commentKarma
                  }
                END,
        Album: CASE
                WHEN album IS NULL THEN null
                ELSE {
                    id: album.id,
                    imageOrder: album.imageOrder,
                    Images: albumImages
                }
              END,
        Tags: [t IN tagsText | {text: t}],
        DownloadableFiles: downloadableFiles,
        // Membership-derived MOD badge: is the author channel staff (owner or
        // moderator) of this channel? Computed inline because the @cypher field
        // of the same name only auto-resolves on the generated `discussions`
        // query, not inside this custom resolver. Mirrors typeDefs.ts.
        authorIsChannelModerator: CASE
            WHEN author IS NULL THEN false
            WHEN EXISTS { (author)-[:ADMIN_OF_CHANNEL]->(:Channel {uniqueName: dc.channelUniqueName}) }
              OR EXISTS { (author)-[:MODERATION_PROFILE]->(:ModerationProfile)-[:MODERATOR_OF_CHANNEL]->(:Channel {uniqueName: dc.channelUniqueName}) }
            THEN true
            ELSE false
        END
    },
    Channel: {
        uniqueName: dc.channelUniqueName
    },
    isFavorited: isFavorited
} AS DiscussionChannel
ORDER BY pagePosition
