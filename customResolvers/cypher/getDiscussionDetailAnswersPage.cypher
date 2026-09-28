MATCH (entry:DiscussionChannel {
  discussionId: $discussionId,
  channelUniqueName: $channelUniqueName
})-[:POSTED_IN_CHANNEL]->(discussion:Discussion {id: $discussionId})
MATCH (entry)-[:POSTED_IN_CHANNEL]->(:Channel {uniqueName: $channelUniqueName})
WHERE $mayAccessSensitiveContent
   OR coalesce(discussion.hasSensitiveContent, false) = false
MATCH (answer:Comment)-[:IS_REPLY_TO]->(entry)
WHERE ($mayAccessSensitiveContent OR coalesce(answer.ageGateRestricted, false) = false)
  AND (
    $cursorCreatedAt IS NULL
    OR answer.createdAt < datetime($cursorCreatedAt)
    OR (answer.createdAt = datetime($cursorCreatedAt) AND answer.id > $cursorId)
  )
OPTIONAL MATCH (answerAuthor:User|ModerationProfile)-[:AUTHORED_COMMENT]->(answer)
WITH answer, answerAuthor
ORDER BY answer.createdAt DESC, answer.id ASC
LIMIT toInteger($pageLimit)
RETURN answer {
  .id,
  .text,
  .createdAt,
  CommentAuthor: CASE WHEN answerAuthor IS NULL THEN null ELSE answerAuthor {
    .username,
    .displayName
  } END
} AS item,
answer.createdAt AS cursorCreatedAt,
answer.id AS cursorId

