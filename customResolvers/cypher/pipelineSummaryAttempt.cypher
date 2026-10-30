MATCH (a:PluginPipelineRun {id: $id})
RETURN a { ATTEMPT_FIELDS } AS attempt
LIMIT 1
