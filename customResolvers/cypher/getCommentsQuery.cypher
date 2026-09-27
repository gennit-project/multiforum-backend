MATCH (entry:DiscussionChannel {id: $discussionChannelId})

// Select the requested page before expanding any one-to-many relationships.
CALL {
  WITH entry
  MATCH (entry)-[:CONTAINS_COMMENT]->(comment:Comment)
  WHERE comment.isRootComment = true
    AND NOT EXISTS { (comment)-[:HAS_FEEDBACK_COMMENT]->(:Discussion) }
  WITH comment,
    CASE
      WHEN coalesce(comment.weightedVotesCount, 0) < 0 THEN 0
      ELSE coalesce(comment.weightedVotesCount, 0)
    END AS rankingVotes,
    duration.between(comment.createdAt, datetime()).months
      + duration.between(comment.createdAt, datetime()).days / 30.0 AS ageInMonths
  WITH comment, rankingVotes,
    log10(rankingVotes + 1) / ((ageInMonths + $hotAgeOffsetMonths) ^ $hotGravity) AS hotRank
  ORDER BY
    coalesce(comment.isSticky, false) DESC,
    CASE WHEN $sortOption = 'top' THEN rankingVotes END DESC,
    CASE WHEN $sortOption = 'hot' THEN hotRank END DESC,
    comment.createdAt DESC
  SKIP toInteger($offset)
  LIMIT toInteger($limit)
  RETURN comment
}

OPTIONAL MATCH (author:User|ModerationProfile)-[:AUTHORED_COMMENT]->(comment)

CALL {
  WITH comment
  OPTIONAL MATCH (upvoter:User)-[:UPVOTED_COMMENT]->(comment)
  RETURN count(upvoter) AS upvoteCount,
    [username IN collect(upvoter.username) WHERE username IS NOT NULL | {username: username}] AS upvoters
}

CALL {
  WITH comment
  OPTIONAL MATCH (superUpvoter:User)-[:SUPER_UPVOTED_COMMENT]->(comment)
  RETURN [username IN collect(superUpvoter.username) WHERE username IS NOT NULL | {username: username}] AS superUpvoters
}

CALL {
  WITH comment
  OPTIONAL MATCH (child:Comment)-[:IS_REPLY_TO]->(comment)
  RETURN count(child) AS childCommentCount
}

CALL {
  WITH comment
  OPTIONAL MATCH (comment)-[:HAS_VERSION]->(version:TextVersion)
  OPTIONAL MATCH (versionAuthor:User)-[:AUTHORED_VERSION]->(version)
  WITH version, versionAuthor
  ORDER BY version.createdAt DESC, version.id ASC
  RETURN [value IN collect(CASE WHEN version IS NULL THEN null ELSE version {
    .id, .body, .editReason, .createdAt,
    Author: CASE WHEN versionAuthor IS NULL THEN null ELSE versionAuthor {.username} END
  } END) WHERE value IS NOT NULL] AS pastVersions
}

CALL {
  WITH comment
  OPTIONAL MATCH (feedback:Comment)-[:HAS_FEEDBACK_COMMENT]->(comment)
  OPTIONAL MATCH (feedbackAuthor:ModerationProfile)-[:AUTHORED_COMMENT]->(feedback)
  WHERE feedback IS NULL
    OR ($modName IS NOT NULL AND feedbackAuthor.displayName = $modName)
  RETURN [value IN collect(CASE WHEN feedback IS NULL THEN null ELSE {id: feedback.id} END)
    WHERE value IS NOT NULL] AS feedbackComments
}

CALL {
  WITH comment
  OPTIONAL MATCH (viewer:User {username: $loggedInUsername})
  RETURN CASE WHEN viewer IS NULL THEN false
    ELSE EXISTS { (viewer)-[:DEFAULT_FAVORITES_COMMENTS]->(comment) }
  END AS isFavoritedByUser,
  CASE WHEN viewer IS NULL OR NOT EXISTS { (viewer)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(comment) }
    THEN []
    ELSE [{username: viewer.username}]
  END AS viewerSubscription
}

RETURN comment {
  .id, .text, .emoji, .weightedVotesCount, .createdAt, .updatedAt,
  .textLastEdited, .archived,
  isSticky: coalesce(comment.isSticky, false),
  .stickyAt, .stickyByUsername,
  CommentAuthor: CASE WHEN author IS NULL THEN null ELSE author {
    .username, .displayName, .profilePicURL, .discussionKarma,
    .commentKarma, .createdAt, .isBot
  } END,
  isFavoritedByUser: isFavoritedByUser,
  ParentComment: null,
  UpvotedByUsers: upvoters,
  UpvotedByUsersAggregate: {count: upvoteCount},
  SuperUpvotedByUsers: superUpvoters,
  ChildCommentsAggregate: {count: childCommentCount},
  FeedbackComments: feedbackComments,
  PastVersions: pastVersions,
  SubscribedToNotifications: viewerSubscription
} AS comment
