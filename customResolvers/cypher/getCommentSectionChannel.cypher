MATCH (entry:DiscussionChannel {
  discussionId: $discussionId,
  channelUniqueName: $channelUniqueName
})-[:POSTED_IN_CHANNEL]->(discussion:Discussion {id: $discussionId})
MATCH (entry)-[:POSTED_IN_CHANNEL]->(channel:Channel {uniqueName: $channelUniqueName})

OPTIONAL MATCH (discussionAuthor:User)-[:POSTED_DISCUSSION]->(discussion)

CALL {
  WITH entry
  OPTIONAL MATCH (upvoter:User)-[:UPVOTED_DISCUSSION]->(entry)
  RETURN count(upvoter) AS upvoteCount,
    [username IN collect(upvoter.username) WHERE username IS NOT NULL | {username: username}] AS upvoters
}

CALL {
  WITH entry
  OPTIONAL MATCH (superUpvoter:User)-[:SUPER_UPVOTED_DISCUSSION]->(entry)
  RETURN [username IN collect(superUpvoter.username) WHERE username IS NOT NULL | {username: username}] AS superUpvoters
}

CALL {
  WITH entry
  OPTIONAL MATCH (entry)-[:CONTAINS_COMMENT]->(comment:Comment)
  WHERE comment IS NULL OR coalesce(comment.isFeedbackComment, false) = false
  RETURN count(comment) AS commentCount,
    count(CASE WHEN comment.isRootComment = true THEN 1 END) AS rootCommentCount
}

CALL {
  WITH entry
  OPTIONAL MATCH (answer:Comment)-[:IS_REPLY_TO]->(entry)
  OPTIONAL MATCH (answerAuthor:User|ModerationProfile)-[:AUTHORED_COMMENT]->(answer)
  WITH answer, answerAuthor
  ORDER BY answer.createdAt DESC, answer.id ASC
  LIMIT toInteger($answerLimit)
  RETURN [value IN collect(CASE WHEN answer IS NULL THEN null ELSE answer {
    .id, .text, .createdAt,
    CommentAuthor: CASE WHEN answerAuthor IS NULL THEN null ELSE answerAuthor {
      .username, .displayName
    } END
  } END) WHERE value IS NOT NULL] AS answers
}

CALL {
  WITH channel
  OPTIONAL MATCH (channel)-[:BOT]->(bot:User)
  RETURN [value IN collect(CASE WHEN bot IS NULL THEN null ELSE bot {
    .username, .displayName, .botProfileId, .isDeprecated
  } END) WHERE value IS NOT NULL] AS bots
}

CALL {
  WITH channel
  OPTIONAL MATCH (moderator:ModerationProfile)-[:MODERATOR_OF_CHANNEL]->(channel)
  RETURN [value IN collect(CASE WHEN moderator IS NULL THEN null ELSE moderator {
    .displayName
  } END) WHERE value IS NOT NULL] AS moderators
}

CALL {
  WITH entry
  OPTIONAL MATCH (viewer:User {username: $loggedInUsername})-[:SUBSCRIBED_TO_NOTIFICATIONS]->(entry)
  RETURN CASE WHEN viewer IS NULL THEN [] ELSE [{username: viewer.username}] END AS viewerSubscription
}

RETURN entry {
  .id, .weightedVotesCount, .discussionId, .channelUniqueName, .emoji,
  .archived, .locked, .answered,
  UpvotedByUsers: upvoters,
  UpvotedByUsersAggregate: {count: upvoteCount},
  SuperUpvotedByUsers: superUpvoters,
  CommentsAggregate: {count: commentCount},
  RootCommentsAggregate: {count: rootCommentCount},
  SubscribedToNotifications: viewerSubscription,
  Answers: answers,
  Channel: channel {
    .uniqueName, .feedbackEnabled, .imageUploadsEnabled,
    .markdownImagesEnabled, .emojiEnabled,
    Bots: bots,
    Moderators: moderators
  },
  Discussion: discussion {
    .id, .title,
    Author: CASE WHEN discussionAuthor IS NULL THEN null ELSE discussionAuthor {
      .username, .displayName, .profilePicURL, .commentKarma,
      .createdAt, .discussionKarma
    } END
  }
} AS DiscussionChannel
