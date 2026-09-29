MATCH (entry:DiscussionChannel {
  discussionId: $discussionId,
  channelUniqueName: $channelUniqueName
})-[:POSTED_IN_CHANNEL]->(discussion:Discussion {id: $discussionId})
MATCH (entry)-[:POSTED_IN_CHANNEL]->(:Channel {uniqueName: $channelUniqueName})
WHERE $mayAccessSensitiveContent
   OR coalesce(discussion.hasSensitiveContent, false) = false
MATCH (discussion)-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile)
WHERE coalesce(file.permanentlyRemoved, false) = false
  AND ($mayAccessSensitiveContent OR coalesce(file.ageGateRestricted, false) = false)
  AND (
    $cursorCreatedAt IS NULL
    OR file.createdAt > datetime($cursorCreatedAt)
    OR (file.createdAt = datetime($cursorCreatedAt) AND file.id > $cursorId)
  )
OPTIONAL MATCH (file)-[:USES_LICENSE]->(license:License)
WITH file, license
ORDER BY file.createdAt ASC, file.id ASC
LIMIT toInteger($pageLimit)
RETURN file {
  .id,
  .createdAt,
  .fileName,
  .url,
  .kind,
  .size,
  .priceModel,
  .priceCents,
  .priceCurrency,
  .downloadCountTotal,
  .downloadCountUnique,
  .attributionOverride,
  .supportPatreonUrl,
  .supportBuyMeACoffeeUrl,
  .supportKoFiUrl,
  .supportPayPalMeUrl,
  .scanStatus,
  .scanCheckedAt,
  .scanReason,
  .uploadedByUsername,
  license: CASE WHEN license IS NULL THEN null ELSE license {
    .id,
    .name
  } END
} AS item,
file.createdAt AS cursorCreatedAt,
file.id AS cursorId

