// Hydrate only the IDs selected by the lightweight page query. Keeping each
// one-to-many relationship in its own scoped subquery prevents row products.
UNWIND range(0, size($discussionIds) - 1) AS pagePosition
WITH pagePosition, $discussionIds[pagePosition] AS discussionId
MATCH (d:Discussion {id: discussionId})

CALL {
  WITH d
  MATCH (dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(d)
  WHERE ($showArchived OR coalesce(dc.archived, false) = false)
    AND (size($selectedChannels) = 0 OR dc.channelUniqueName IN $selectedChannels)
  OPTIONAL MATCH (channelNode:Channel {uniqueName: dc.channelUniqueName})

  CALL {
    WITH dc
    OPTIONAL MATCH (upvoter:User)-[:UPVOTED_DISCUSSION]->(dc)
    RETURN [up IN collect(DISTINCT upvoter) WHERE up IS NOT NULL |
      {username: up.username}] AS upvotedByUsers
  }
  CALL {
    WITH dc
    OPTIONAL MATCH (superUpvoter:User)-[:SUPER_UPVOTED_DISCUSSION]->(dc)
    RETURN [up IN collect(DISTINCT superUpvoter) WHERE up IS NOT NULL |
      {username: up.username}] AS superUpvotedByUsers
  }
  CALL {
    WITH dc
    OPTIONAL MATCH (dc)-[:CONTAINS_COMMENT]->(comment:Comment)
    WHERE comment.isFeedbackComment IS NULL OR comment.isFeedbackComment = false
    RETURN count(DISTINCT comment) AS commentsCount
  }
  CALL {
    WITH dc
    OPTIONAL MATCH (dc)-[:HAS_DISCUSSION_FLAIR]->(assignedFlair:DiscussionFlair)
    WITH assignedFlair
    ORDER BY assignedFlair.order ASC, assignedFlair.displayName ASC
    RETURN [flair IN collect(DISTINCT assignedFlair) WHERE flair IS NOT NULL | {
      id: flair.id,
      channelUniqueName: flair.channelUniqueName,
      displayName: flair.displayName,
      color: flair.color,
      order: flair.order,
      archived: flair.archived
    }] AS assignedFlairs
  }

  WITH d, dc, channelNode, upvotedByUsers, superUpvotedByUsers,
       commentsCount, assignedFlairs
  ORDER BY dc.createdAt ASC, dc.id ASC
  RETURN collect({
    id: dc.id,
    createdAt: dc.createdAt,
    channelUniqueName: dc.channelUniqueName,
    discussionId: d.id,
    weightedVotesCount: dc.weightedVotesCount,
    archived: dc.archived,
    answered: dc.answered,
    locked: dc.locked,
    Flairs: assignedFlairs,
    Channel: {
      uniqueName: dc.channelUniqueName,
      displayName: channelNode.displayName,
      channelIconURL: channelNode.channelIconURL
    },
    UpvotedByUsers: upvotedByUsers,
    SuperUpvotedByUsers: superUpvotedByUsers,
    CommentsAggregate: {count: commentsCount}
  }) AS discussionChannels
}

CALL {
  WITH d
  OPTIONAL MATCH (d)-[:HAS_TAG]->(tag:Tag)
  RETURN [tagText IN collect(DISTINCT tag.text) WHERE tagText IS NOT NULL |
    {text: tagText}] AS tags
}

OPTIONAL MATCH (d)<-[:POSTED_DISCUSSION]-(author:User)

CALL {
  WITH d
  OPTIONAL MATCH (d)-[:HAS_ALBUM]->(album:Album)
  OPTIONAL MATCH (album)-[:HAS_IMAGE]->(image:Image)
  WHERE image.id IS NOT NULL
    AND coalesce(image.archived, false) = false
    AND coalesce(image.permanentlyRemoved, false) = false
    AND ($mayAccessSensitiveContent OR coalesce(image.hasSensitiveContent, false) = false)
  RETURN head(collect(DISTINCT album)) AS album,
         [img IN collect(DISTINCT image) WHERE img IS NOT NULL | {
           id: img.id,
           url: img.url,
           alt: img.alt,
           caption: img.caption,
           archived: img.archived,
           permanentlyRemoved: img.permanentlyRemoved
         }] AS albumImages
}

CALL {
  WITH d
  OPTIONAL MATCH (d)-[:HAS_DOWNLOADABLE_FILE]->(downloadableFile:DownloadableFile)
  WHERE downloadableFile.permanentlyRemoved IS NULL OR downloadableFile.permanentlyRemoved = false
  RETURN [downloadableFile IN collect(DISTINCT downloadableFile)
    WHERE downloadableFile IS NOT NULL | {
    id: downloadableFile.id,
    scanStatus: downloadableFile.scanStatus
  }] AS downloadableFiles
}

RETURN {
  id: d.id,
  title: d.title,
  body: d.body,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  hasSensitiveContent: d.hasSensitiveContent,
  hasSpoiler: d.hasSpoiler,
  Author: CASE WHEN author IS NULL THEN null ELSE {
    username: author.username,
    displayName: author.displayName,
    profilePicURL: author.profilePicURL,
    createdAt: author.createdAt,
    discussionKarma: author.discussionKarma,
    commentKarma: author.commentKarma
  } END,
  DiscussionChannels: discussionChannels,
  Tags: tags,
  Album: CASE WHEN album IS NULL THEN null ELSE {
    id: album.id,
    imageOrder: album.imageOrder,
    Images: albumImages
  } END,
  DownloadableFiles: downloadableFiles,
  isFavorited: CASE
    WHEN $loggedInUsername IS NULL OR $loggedInUsername = "" THEN null
    ELSE EXISTS {
      MATCH (:User {username: $loggedInUsername})-[:DEFAULT_FAVORITES_DISCUSSIONS]->(d)
    }
  END
} AS discussion
ORDER BY pagePosition
