MATCH (a:PluginPipelineRun {targetId: $targetId, targetType: $targetType})
WHERE ($scope IS NULL OR a.scope = $scope)
    AND ($eventType IS NULL OR a.eventType = $eventType)
  AND ($channelId IS NULL OR a.channelId = $channelId)
  AND a.createdAt IS NOT NULL AND a.id IS NOT NULL
  AND ($afterId IS NULL OR a.createdAt < datetime($afterCreatedAt)
    OR (a.createdAt = datetime($afterCreatedAt) AND a.id < $afterId))
WITH a ORDER BY a.createdAt DESC, a.id DESC LIMIT $limit
RETURN a { ATTEMPT_FIELDS } AS attempt
