MATCH (discussion:Discussion {id: $discussionId})
WHERE $mayAccessSensitiveContent
   OR coalesce(discussion.hasSensitiveContent, false) = false
OPTIONAL MATCH (discussion)-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile)
WHERE file IS NOT NULL
  AND coalesce(file.permanentlyRemoved, false) = false
  AND ($mayAccessSensitiveContent OR coalesce(file.ageGateRestricted, false) = false)
OPTIONAL MATCH (file)-[:USES_LICENSE]->(license:License)
WITH file, license
ORDER BY file.createdAt ASC, file.id ASC
LIMIT toInteger($fileLimit)
RETURN [value IN collect(CASE WHEN file IS NULL THEN null ELSE file {
  .id,
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
} END) WHERE value IS NOT NULL] AS DownloadableFiles
