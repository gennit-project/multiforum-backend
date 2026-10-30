import type { Driver } from 'neo4j-driver';

export const pipelineSummaryIndexStatements = [
  'CREATE RANGE INDEX pipeline_summary_attempt_page IF NOT EXISTS FOR (a:PluginPipelineRun) ON (a.targetId, a.targetType, a.createdAt, a.id)',
  'CREATE RANGE INDEX pipeline_summary_attempt_status IF NOT EXISTS FOR (a:PluginPipelineRun) ON (a.targetId, a.targetType, a.status)',
  'CREATE RANGE INDEX pipeline_summary_job_status IF NOT EXISTS FOR (j:PluginRun) ON (j.targetId, j.targetType, j.status)',
  'CREATE RANGE INDEX pipeline_summary_job_pipeline IF NOT EXISTS FOR (j:PluginRun) ON (j.pipelineId)',
] as const;
export async function ensurePipelineSummaryIndexes(driver: Driver): Promise<void> {
  const session = driver.session();
  try { for (const query of pipelineSummaryIndexStatements) await session.run(query); }
  finally { await session.close(); }
}
