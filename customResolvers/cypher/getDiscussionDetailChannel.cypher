MATCH (discussion:Discussion {id: $discussionId})
WHERE $mayAccessSensitiveContent
   OR coalesce(discussion.hasSensitiveContent, false) = false
MATCH (entry:DiscussionChannel {
  discussionId: $discussionId,
  channelUniqueName: $channelUniqueName
})-[:POSTED_IN_CHANNEL]->(discussion)
MATCH (entry)-[:POSTED_IN_CHANNEL]->(channel:Channel)

CALL {
  WITH entry
  OPTIONAL MATCH (upvoter:User)-[:UPVOTED_DISCUSSION]->(entry)
  RETURN count(upvoter) AS upvoteCount
}

CALL {
  WITH entry
  OPTIONAL MATCH (viewer:User {username: $viewerUsername})-[:UPVOTED_DISCUSSION]->(entry)
  RETURN CASE WHEN viewer IS NULL THEN [] ELSE [{username: viewer.username}] END AS viewerUpvote
}

CALL {
  WITH entry
  OPTIONAL MATCH (viewer:User {username: $viewerUsername})-[:SUPER_UPVOTED_DISCUSSION]->(entry)
  RETURN CASE WHEN viewer IS NULL THEN [] ELSE [{username: viewer.username}] END AS viewerSuperUpvote
}

CALL {
  WITH entry
  OPTIONAL MATCH (entry)-[:CONTAINS_COMMENT]->(comment:Comment)
  WHERE comment IS NULL OR coalesce(comment.isFeedbackComment, false) = false
  RETURN count(comment) AS commentCount
}

CALL {
  WITH entry
  OPTIONAL MATCH (answer:Comment)-[:IS_REPLY_TO]->(entry)
  WHERE answer IS NULL
     OR $mayAccessSensitiveContent
     OR coalesce(answer.ageGateRestricted, false) = false
  OPTIONAL MATCH (answerAuthor)-[:AUTHORED_COMMENT]->(answer)
  WITH answer, answerAuthor
  ORDER BY answer.createdAt DESC, answer.id ASC
  LIMIT toInteger($answerLimit) + 1
  WITH [value IN collect(CASE WHEN answer IS NULL THEN null ELSE answer {
    .id,
    .text,
    .createdAt,
    CommentAuthor: CASE WHEN answerAuthor IS NULL THEN null ELSE answerAuthor {
      .username,
      .displayName
    } END
  } END) WHERE value IS NOT NULL] AS answerCandidates
  RETURN answerCandidates[..toInteger($answerLimit)] AS answers,
    size(answerCandidates) > toInteger($answerLimit) AS hasNextPage
}

CALL {
  WITH entry
  OPTIONAL MATCH (entry)-[:HAS_DISCUSSION_FLAIR]->(flair:DiscussionFlair)
  WITH flair
  ORDER BY flair.order ASC, flair.displayName ASC
  RETURN [value IN collect(CASE WHEN flair IS NULL THEN null ELSE flair {
    .id,
    .channelUniqueName,
    .displayName,
    .color,
    .order,
    .archived
  } END) WHERE value IS NOT NULL] AS flairs
}

CALL {
  WITH entry
  OPTIONAL MATCH (entry)-[:HAS_LABEL_OPTION]->(option:FilterOption)<-[:HAS_FILTER_OPTION]-(group:FilterGroup)
  WITH option, group
  ORDER BY group.order ASC, option.order ASC
  RETURN [value IN collect(CASE WHEN option IS NULL THEN null ELSE option {
    .id,
    .value,
    .displayName,
    .order,
    group: CASE WHEN group IS NULL THEN null ELSE group {
      .id,
      .key,
      .displayName
    } END
  } END) WHERE value IS NOT NULL] AS labelOptions
}

RETURN entry {
  .id,
  .discussionId,
  .channelUniqueName,
  .weightedVotesCount,
  .archived,
  .answered,
  .locked,
  .emoji,
  Flairs: flairs,
  UpvotedByUsers: viewerUpvote,
  UpvotedByUsersAggregate: {count: upvoteCount},
  SuperUpvotedByUsers: viewerSuperUpvote,
  CommentsAggregate: {count: commentCount},
  Answers: answers,
  _detailAnswersHasNextPage: hasNextPage,
  LabelOptions: labelOptions,
  Discussion: {id: discussion.id},
  Channel: channel {
    .uniqueName,
    .channelIconURL,
    .displayName,
    .feedbackEnabled,
    .imageUploadsEnabled,
    .markdownImagesEnabled,
    .emojiEnabled
  }
} AS DiscussionChannel
