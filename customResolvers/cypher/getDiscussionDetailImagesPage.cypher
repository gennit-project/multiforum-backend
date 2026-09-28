MATCH (entry:DiscussionChannel {
  discussionId: $discussionId,
  channelUniqueName: $channelUniqueName
})-[:POSTED_IN_CHANNEL]->(discussion:Discussion {id: $discussionId})
MATCH (entry)-[:POSTED_IN_CHANNEL]->(:Channel {uniqueName: $channelUniqueName})
WHERE $mayAccessSensitiveContent
   OR coalesce(discussion.hasSensitiveContent, false) = false
MATCH (discussion)-[:HAS_ALBUM]->(:Album)-[:HAS_IMAGE]->(image:Image)
WHERE coalesce(image.archived, false) = false
  AND coalesce(image.permanentlyRemoved, false) = false
  AND ($mayAccessSensitiveContent OR coalesce(image.hasSensitiveContent, false) = false)
  AND (
    $cursorCreatedAt IS NULL
    OR image.createdAt < datetime($cursorCreatedAt)
    OR (image.createdAt = datetime($cursorCreatedAt) AND image.id > $cursorId)
  )
OPTIONAL MATCH (uploader:User)-[:UPLOADED_IMAGE]->(image)
WITH image, uploader
ORDER BY image.createdAt DESC, image.id ASC
LIMIT toInteger($pageLimit)
RETURN image {
  .id,
  .createdAt,
  .url,
  .alt,
  .caption,
  .copyright,
  Uploader: CASE WHEN uploader IS NULL THEN null ELSE uploader {
    .username,
    .displayName
  } END
} AS item,
image.createdAt AS cursorCreatedAt,
image.id AS cursorId

