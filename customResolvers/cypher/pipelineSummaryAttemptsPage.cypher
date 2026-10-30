// Include the equality-prefix properties in ORDER BY so Neo4j 5 can stream index order.
MATCH (a:PluginPipelineRun {targetId: $targetId, targetType: $targetType})
USING INDEX SEEK a:PluginPipelineRun(targetId, targetType, createdAt, id)
WHERE ($scope IS NULL OR a.scope = $scope)
    AND ($eventType IS NULL OR a.eventType = $eventType)
  AND ($channelId IS NULL OR a.channelId = $channelId)
  AND a.createdAt IS NOT NULL AND a.id IS NOT NULL
  // CURSOR_FILTER
WITH a ORDER BY a.targetId DESC, a.targetType DESC, a.createdAt DESC, a.id DESC LIMIT $limit
RETURN a { ATTEMPT_FIELDS } AS attempt
