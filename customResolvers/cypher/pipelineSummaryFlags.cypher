RETURN
EXISTS {
  MATCH (a:PluginPipelineRun {targetId: $targetId, targetType: $targetType})
  USING INDEX a:PluginPipelineRun(targetId, targetType, status)
  WHERE a.status IN ['QUEUED', 'RUNNING']
    AND ($scope IS NULL OR a.scope = $scope)
    AND ($eventType IS NULL OR a.eventType = $eventType)
    AND ($channelId IS NULL OR a.channelId = $channelId)
} OR EXISTS {
  MATCH (j:PluginRun {targetId: $targetId, targetType: $targetType})
  USING INDEX j:PluginRun(targetId, targetType, status)
  WHERE j.status IN ['PENDING', 'RUNNING']
    AND ($scope IS NULL OR j.scope = $scope)
    AND ($eventType IS NULL OR j.eventType = $eventType)
    AND ($channelId IS NULL OR j.channelId = $channelId)
} AS hasActiveWork,
EXISTS {
  MATCH (a:PluginPipelineRun {targetId: $targetId, targetType: $targetType})
  USING INDEX a:PluginPipelineRun(targetId, targetType, status)
  WHERE a.status IN ['FAILED', 'TIMED_OUT']
    AND ($scope IS NULL OR a.scope = $scope)
    AND ($eventType IS NULL OR a.eventType = $eventType)
    AND ($channelId IS NULL OR a.channelId = $channelId)
} OR EXISTS {
  MATCH (j:PluginRun {targetId: $targetId, targetType: $targetType})
  USING INDEX j:PluginRun(targetId, targetType, status)
  WHERE j.status IN ['FAILED', 'TIMED_OUT']
    AND ($scope IS NULL OR j.scope = $scope)
    AND ($eventType IS NULL OR j.eventType = $eventType)
    AND ($channelId IS NULL OR j.channelId = $channelId)
} AS hasFailedWork
