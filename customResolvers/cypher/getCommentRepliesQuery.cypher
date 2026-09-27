MATCH (parent:Comment {id: $commentId})

CALL {
  WITH parent
  OPTIONAL MATCH (child:Comment)-[:IS_REPLY_TO]->(parent)
  RETURN count(child) AS aggregateChildCommentCount
}

CALL {
  WITH parent
  MATCH (child:Comment)-[:IS_REPLY_TO]->(parent)
  WITH child,
    CASE
      WHEN coalesce(child.weightedVotesCount, 0) < 0 THEN 0
      ELSE coalesce(child.weightedVotesCount, 0)
    END AS rankingVotes,
    duration.between(child.createdAt, datetime()).months
      + duration.between(child.createdAt, datetime()).days / 30.0 AS ageInMonths
  WITH child, rankingVotes,
    log10(rankingVotes + 1) / ((ageInMonths + $hotAgeOffsetMonths) ^ $hotGravity) AS hotRank
  ORDER BY
    CASE WHEN $sortOption = 'top' THEN rankingVotes END DESC,
    CASE WHEN $sortOption = 'hot' THEN hotRank END DESC,
    child.createdAt DESC
  SKIP toInteger($offset)
  LIMIT toInteger($limit)

  OPTIONAL MATCH (author:User|ModerationProfile)-[:AUTHORED_COMMENT]->(child)

  CALL {
    WITH child
    OPTIONAL MATCH (upvoter:User)-[:UPVOTED_COMMENT]->(child)
    RETURN count(upvoter) AS upvoteCount,
      [username IN collect(upvoter.username) WHERE username IS NOT NULL | {username: username}] AS upvoters
  }

  CALL {
    WITH child
    OPTIONAL MATCH (superUpvoter:User)-[:SUPER_UPVOTED_COMMENT]->(child)
    RETURN [username IN collect(superUpvoter.username) WHERE username IS NOT NULL | {username: username}] AS superUpvoters
  }

  CALL {
    WITH child
    OPTIONAL MATCH (grandchild:Comment)-[:IS_REPLY_TO]->(child)
    RETURN count(grandchild) AS grandchildCount
  }

  CALL {
    WITH child
    OPTIONAL MATCH (child)-[:HAS_VERSION]->(version:TextVersion)
    OPTIONAL MATCH (versionAuthor:User)-[:AUTHORED_VERSION]->(version)
    WITH version, versionAuthor
    ORDER BY version.createdAt DESC, version.id ASC
    RETURN [value IN collect(CASE WHEN version IS NULL THEN null ELSE version {
      .id, .body, .editReason, .createdAt,
      Author: CASE WHEN versionAuthor IS NULL THEN null ELSE versionAuthor {.username} END
    } END) WHERE value IS NOT NULL] AS pastVersions
  }

  CALL {
    WITH child
    OPTIONAL MATCH (feedback:Comment)-[:HAS_FEEDBACK_COMMENT]->(child)
    OPTIONAL MATCH (feedbackAuthor:ModerationProfile)-[:AUTHORED_COMMENT]->(feedback)
    WHERE feedback IS NULL
      OR ($modName IS NOT NULL AND feedbackAuthor.displayName = $modName)
    RETURN [value IN collect(CASE WHEN feedback IS NULL THEN null ELSE {id: feedback.id} END)
      WHERE value IS NOT NULL] AS feedbackComments
  }

  CALL {
    WITH child
    OPTIONAL MATCH (viewer:User {username: $loggedInUsername})
    RETURN CASE WHEN viewer IS NULL THEN false
      ELSE EXISTS { (viewer)-[:DEFAULT_FAVORITES_COMMENTS]->(child) }
    END AS isFavoritedByUser,
    CASE WHEN viewer IS NULL OR NOT EXISTS { (viewer)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(child) }
      THEN []
      ELSE [{username: viewer.username}]
    END AS viewerSubscription
  }

  CALL {
    WITH child
    OPTIONAL MATCH (event:Event)-[:HAS_COMMENT]->(child)
    RETURN CASE WHEN event IS NULL THEN null ELSE {id: event.id} END AS event
  }

  CALL {
    WITH child
    OPTIONAL MATCH (entry:DiscussionChannel)-[:CONTAINS_COMMENT]->(child)
    RETURN CASE WHEN entry IS NULL THEN null ELSE entry {
      .id, .channelUniqueName, .discussionId
    } END AS discussionChannel
  }

  WITH child, rankingVotes, hotRank, author, upvoteCount, upvoters, superUpvoters, grandchildCount,
    pastVersions, feedbackComments, isFavoritedByUser, viewerSubscription,
    event, discussionChannel
  ORDER BY
    CASE WHEN $sortOption = 'top' THEN rankingVotes END DESC,
    CASE WHEN $sortOption = 'hot' THEN hotRank END DESC,
    child.createdAt DESC
  RETURN collect(child {
    .id, .text, .emoji, .weightedVotesCount, .createdAt, .updatedAt,
    .textLastEdited, .archived,
    isSticky: coalesce(child.isSticky, false),
    .stickyAt, .stickyByUsername,
    ParentComment: {id: $commentId},
    CommentAuthor: CASE WHEN author IS NULL THEN null ELSE author {
      .username, .displayName, .profilePicURL, .discussionKarma,
      .commentKarma, .createdAt, .isBot
    } END,
    isFavoritedByUser: isFavoritedByUser,
    UpvotedByUsers: upvoters,
    UpvotedByUsersAggregate: {count: upvoteCount},
    SuperUpvotedByUsers: superUpvoters,
    ChildCommentsAggregate: {count: grandchildCount},
    FeedbackComments: feedbackComments,
    PastVersions: pastVersions,
    SubscribedToNotifications: viewerSubscription,
    Event: event,
    DiscussionChannel: discussionChannel
  }) AS childComments
}

RETURN childComments AS ChildComments,
  aggregateChildCommentCount
