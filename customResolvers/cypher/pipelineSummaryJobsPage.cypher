UNWIND $attempts AS a
CALL {
  WITH a
  MATCH (j:PluginRun {pipelineId: a.pipelineId, targetId: a.targetId, targetType: a.targetType})
  WHERE j.eventType = a.eventType AND j.scope = a.scope AND coalesce(j.channelId, '') = coalesce(a.channelId, '')
    AND ($afterId IS NULL OR coalesce(j.executionOrder, 0) > $afterOrder
      OR (coalesce(j.executionOrder, 0) = $afterOrder AND j.createdAt < datetime($afterCreatedAt))
      OR (coalesce(j.executionOrder, 0) = $afterOrder AND j.createdAt = datetime($afterCreatedAt) AND j.id < $afterId))
  WITH j ORDER BY coalesce(j.executionOrder, 0) ASC, j.createdAt DESC, j.id DESC LIMIT $limit
  RETURN collect(j { JOB_FIELDS }) AS jobs
}
RETURN a.id AS id, jobs,
  [status IN ['PENDING', 'RUNNING', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'SUCCEEDED', 'SKIPPED'] WHERE EXISTS {
    MATCH (j:PluginRun {pipelineId: a.pipelineId, targetId: a.targetId, targetType: a.targetType, status: status})
    WHERE j.eventType = a.eventType AND j.scope = a.scope AND coalesce(j.channelId, '') = coalesce(a.channelId, '')
  }] AS statuses
