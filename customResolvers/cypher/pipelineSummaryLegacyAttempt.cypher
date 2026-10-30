// pipelineId has a production uniqueness constraint; LIMIT 2 also rejects dirty legacy data.
MATCH (a:PluginPipelineRun {pipelineId: $pipelineId})
RETURN a { ATTEMPT_FIELDS } AS attempt
LIMIT 2
